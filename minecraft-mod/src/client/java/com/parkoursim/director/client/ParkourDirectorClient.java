package com.parkoursim.director.client;

import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.List;
import java.util.Properties;
import java.util.UUID;

import org.lwjgl.glfw.GLFW;

import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.levelgen.Heightmap;
import net.minecraft.world.phys.Vec3;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.loader.api.FabricLoader;

import com.parkoursim.director.CourseBuilder;
import com.parkoursim.director.CoursePlan;
import com.parkoursim.director.CoursePlan.Placement;
import com.parkoursim.director.CoursePlan.Stage;

public final class ParkourDirectorClient implements ClientModInitializer {
    private static final int INITIAL_BUILD_BATCH = 320;
    private static final int STREAM_BUILD_BATCH = 220;
    private static final double WALK_TICKS_PER_BLOCK = 3.4;
    private static final double JUMP_TICKS_PER_BLOCK = 4.25;
    private static final double JUMP_DISTANCE = 2.5;
    private static final int WALK_LOOK_AHEAD = 7;
    private static final int JUMP_LOOK_AHEAD = 5;
    private static final int PREBUILD_STAGES = 3;
    private static final int STREAM_AHEAD_STAGES = 3;
    private static final double ESTIMATED_SECONDS_PER_STAGE = 10.2;
    private static final long FIXED_DAY_TIME = 6000L;
    private static final int TEMPLATE_VARIANTS_PER_THEME = 5;
    private static final int TEMPLATE_COUNT = 300;
    private static final int THEME_GRID_COLUMNS = 6;
    private static final int THEME_COLUMN_SPACING = 64;
    private static final int THEME_ROW_SPACING = 5120;
    private static final String ANCHOR_LAYOUT_VERSION = "grid60-v3";
    private static final int MANAGED_RENDER_DISTANCE = 12;
    private static final int MANAGED_SIMULATION_DISTANCE = 8;
    private static final List<String> THEMES = List.of(
        "village", "library", "lava", "lush", "checker",
        "honey", "cherry", "ice", "nether", "crystal",
        "desert", "bamboo", "ocean", "mushroom", "copper",
        "redstone", "quartz", "castle", "melon", "coral",
        "rainbow", "swamp", "birch", "azalea", "obsidian",
        "gold", "emerald", "factory", "arcade", "savanna",
        "alpine", "jungle", "coast", "oasis", "candy",
        "clockwork", "marble", "vineyard", "pumpkin", "aquarium",
        "railway", "harbor", "cathedral", "dojo", "oriental",
        "mesa", "quarry", "greenhouse", "carnival", "laboratory",
        "music", "bakery", "volcano", "lagoon", "autumn",
        "winter", "dragon", "maze", "observatory", "stadium"
    );

    private Minecraft client;
    private CoursePlan plan;
    private int buildIndex;
    private int warmupTicks;
    private int stageIndex;
    private final List<Vec3> routePoints = new ArrayList<>();
    private final List<Integer> routeStages = new ArrayList<>();
    private final List<String> routeStageNames = new ArrayList<>();
    private int routeIndex;
    private double segmentTick;
    private boolean running;
    private boolean autoStarted;
    private int autoStartTicks;
    private boolean f8WasDown;
    private boolean f9WasDown;
    private boolean changedHud;
    private int previousFov = 70;
    private float cameraYaw;
    private float cameraPitch;
    private boolean cameraPoseInitialized;
    private String selectedTheme = "village-v01";
    private BlockPos courseOrigin;
    private BlockPos batchAnchor;
    private String activeWorldKey = "";
    private long routeSeed;
    private int cameraProfile;
    private int targetStages;
    private int nextStage;
    private int builtStages;
    private int plannedStage = -1;
    private int elapsedRunTicks;
    private int targetDurationSeconds = 150;
    private int jobPollTicks;
    private int statusTicks;
    private int daylightLockTicks = 20;
    private String activeJobId = "";
    private String lastJobId = "";

    @Override
    public void onInitializeClient() {
        lastJobId = readStatusJobId();
        ClientTickEvents.END_CLIENT_TICK.register(this::tick);
    }

    private void tick(Minecraft minecraft) {
        client = minecraft;
        if (client.player == null || client.level == null) {
            resetSession();
            return;
        }

        // Do not pause while the desktop recorder is focused. Start once automatically
        // after the integrated server has had a few seconds to finish loading the world.
        if (client.options != null) client.options.pauseOnLostFocus = false;
        daylightLockTicks++;
        if (daylightLockTicks >= 20) {
            daylightLockTicks = 0;
            lockBrightDay();
        }
        jobPollTicks++;
        if (jobPollTicks >= 10) {
            jobPollTicks = 0;
            processExternalJob();
        }
        if (!autoStarted) {
            autoStartTicks++;
            if (autoStartTicks >= 80 && client.getSingleplayerServer() != null) {
                autoStarted = true;
                startOrRebuild();
            }
        }

        long window = client.getWindow().handle();
        boolean f8 = GLFW.glfwGetKey(window, GLFW.GLFW_KEY_F8) == GLFW.GLFW_PRESS;
        boolean f9 = GLFW.glfwGetKey(window, GLFW.GLFW_KEY_F9) == GLFW.GLFW_PRESS;
        if (f8 && !f8WasDown) startOrRebuild();
        if (f9 && !f9WasDown) stop();
        f8WasDown = f8;
        f9WasDown = f9;

        if (plan != null && buildIndex < plan.placements().size()) buildNextBatch();
        if (!running && plan == null && builtStages < Math.min(PREBUILD_STAGES, targetStages)) {
            planNextStage();
        }
        if (!running && builtStages >= Math.min(PREBUILD_STAGES, targetStages) && warmupTicks == 0 && routePoints.size() > 1) {
            warmupTicks = 35;
            message("首段场景生成完成，即将开始单向自动跑酷；后续地图会在前方继续生成");
        }
        if (!running && warmupTicks > 0) {
            warmupTicks--;
            if (warmupTicks == 0) beginRun();
            return;
        }
        if (running) {
            if (plan == null && nextStage < targetStages && builtStages - stageIndex <= STREAM_AHEAD_STAGES) {
                planNextStage();
            }
            advanceCamera();
            statusTicks++;
            if (statusTicks >= 20) {
                statusTicks = 0;
                writeStatus("running", "正在单向跑酷并流式生成前方地图");
            }
        }
    }

    private void startOrRebuild() {
        MinecraftServer server = client.getSingleplayerServer();
        LocalPlayer player = client.player;
        if (server == null || player == null) {
            message("请进入单人游戏后再按 F8");
            return;
        }
        String theme = resolveTheme(readSelectedTheme(), System.nanoTime());
        int durationSeconds = readSelectedDuration();
        startJob("manual-" + System.currentTimeMillis(), theme, System.nanoTime(), durationSeconds, 1);
    }

    private void lockBrightDay() {
        MinecraftServer server = client == null ? null : client.getSingleplayerServer();
        if (server == null) return;
        ServerLevel level = server.overworld();
        server.execute(() -> level.dimensionType().defaultClock().ifPresent(clock -> {
            server.clockManager().setTotalTicks(clock, FIXED_DAY_TIME);
            server.clockManager().setPaused(clock, true);
        }));
    }

    private boolean startJob(String jobId, String requestedTheme, long seed, int durationSeconds, int batchIndex) {
        MinecraftServer server = client == null ? null : client.getSingleplayerServer();
        LocalPlayer player = client == null ? null : client.player;
        if (server == null || player == null) return false;

        stopInternal(false);
        activeJobId = jobId;
        selectedTheme = resolveTheme(requestedTheme, seed);
        routeSeed = seed;
        cameraProfile = variationIndex(seed, 0xA24BAED4963EE407L, 4);
        targetDurationSeconds = Math.max(120, Math.min(900, durationSeconds));
        targetStages = Math.max(
            PREBUILD_STAGES,
            (int) Math.ceil((targetDurationSeconds + 25.0) / ESTIMATED_SECONDS_PER_STAGE)
        );
        nextStage = 0;
        builtStages = 0;
        plannedStage = -1;
        elapsedRunTicks = 0;
        statusTicks = 0;
        warmupTicks = 0;
        autoStarted = true;
        cameraPoseInitialized = false;
        if (client.options != null) {
            client.options.renderDistance().set(MANAGED_RENDER_DISTANCE);
            client.options.simulationDistance().set(MANAGED_SIMULATION_DISTANCE);
        }

        ServerLevel level = server.overworld();
        String worldKey = worldKey(server);
        if (!worldKey.equals(activeWorldKey)) {
            activeWorldKey = worldKey;
            batchAnchor = null;
        }
        if (batchAnchor == null) batchAnchor = loadOrCreateBatchAnchor(level, player);
        String baseTheme = CourseBuilder.baseTheme(selectedTheme);
        int themeRegion = Math.max(0, THEMES.indexOf(baseTheme));
        int regionColumn = themeRegion % THEME_GRID_COLUMNS;
        int regionRow = themeRegion / THEME_GRID_COLUMNS;
        int startX = batchAnchor.getX() + regionColumn * THEME_COLUMN_SPACING;
        int startZ = batchAnchor.getZ() + regionRow * THEME_ROW_SPACING;
        int startY = resolveRegionY(level, baseTheme, startX, startZ);
        courseOrigin = new BlockPos(startX, startY, startZ);

        planNextStage();
        writeStatus("building", "正在预生成开头场景，录制将在路线就绪后自动开始");
        message("正在生成新路线：" + CourseBuilder.themeName(selectedTheme)
            + "，固定主题区域 " + (themeRegion + 1) + "/" + THEMES.size()
            + "（网格 " + (regionColumn + 1) + "," + (regionRow + 1) + "）"
            + "，批次 " + batchIndex + "，种子 " + routeSeed + "，约 " + targetDurationSeconds / 60 + " 分钟");
        return true;
    }

    private BlockPos loadOrCreateBatchAnchor(ServerLevel level, LocalPlayer player) {
        Properties properties = readProperties(anchorPath());
        String prefix = worldAnchorPrefix();
        int storedX = (int) parseLong(properties.getProperty(prefix + "anchorX", ""), Integer.MIN_VALUE);
        int storedZ = (int) parseLong(properties.getProperty(prefix + "anchorZ", ""), Integer.MIN_VALUE);
        if (storedX != Integer.MIN_VALUE && storedZ != Integer.MIN_VALUE) {
            if (!ANCHOR_LAYOUT_VERSION.equals(properties.getProperty(prefix + "layoutVersion", ""))) {
                String regionPrefix = prefix + "regionY.";
                List<String> staleRegionKeys = properties.stringPropertyNames().stream()
                    .filter(key -> key.startsWith(regionPrefix))
                    .toList();
                for (String staleRegionKey : staleRegionKeys) {
                    properties.remove(staleRegionKey);
                }
                properties.setProperty("layoutVersion", ANCHOR_LAYOUT_VERSION);
                properties.setProperty(prefix + "layoutVersion", ANCHOR_LAYOUT_VERSION);
                storeProperties(anchorPath(), properties, "ParkourSim per-world fixed 60-theme region grid");
            }
            return new BlockPos(storedX, player.getBlockY(), storedZ);
        }

        boolean hasWorldAnchors = properties.stringPropertyNames().stream().anyMatch(key -> key.startsWith("world."));
        int legacyX = hasWorldAnchors ? Integer.MIN_VALUE
            : (int) parseLong(properties.getProperty("anchorX", ""), Integer.MIN_VALUE);
        int legacyZ = hasWorldAnchors ? Integer.MIN_VALUE
            : (int) parseLong(properties.getProperty("anchorZ", ""), Integer.MIN_VALUE);
        int x = legacyX != Integer.MIN_VALUE ? legacyX : player.getBlockX() + 192;
        int z = legacyZ != Integer.MIN_VALUE ? legacyZ : player.getBlockZ();
        properties.setProperty("layoutVersion", ANCHOR_LAYOUT_VERSION);
        properties.setProperty(prefix + "layoutVersion", ANCHOR_LAYOUT_VERSION);
        properties.setProperty(prefix + "anchorX", Integer.toString(x));
        properties.setProperty(prefix + "anchorZ", Integer.toString(z));
        storeProperties(anchorPath(), properties, "ParkourSim per-world fixed 60-theme region grid");
        return new BlockPos(x, level.getHeight(Heightmap.Types.MOTION_BLOCKING_NO_LEAVES, x, z), z);
    }

    private int resolveRegionY(ServerLevel level, String baseTheme, int x, int z) {
        Properties properties = readProperties(anchorPath());
        String prefix = worldAnchorPrefix();
        String key = prefix + "regionY." + baseTheme;
        int stored = (int) parseLong(properties.getProperty(key, ""), Integer.MIN_VALUE);
        if (stored >= -40 && stored <= 220) return stored;

        int terrainY = level.getHeight(Heightmap.Types.MOTION_BLOCKING_NO_LEAVES, x, z);
        int startY = Math.max(-40, Math.min(220, terrainY + 8));
        properties.setProperty("layoutVersion", ANCHOR_LAYOUT_VERSION);
        properties.setProperty(prefix + "layoutVersion", ANCHOR_LAYOUT_VERSION);
        properties.setProperty(prefix + "anchorX", Integer.toString(batchAnchor.getX()));
        properties.setProperty(prefix + "anchorZ", Integer.toString(batchAnchor.getZ()));
        properties.setProperty(key, Integer.toString(startY));
        storeProperties(anchorPath(), properties, "ParkourSim per-world fixed 60-theme region grid");
        return startY;
    }

    private String worldAnchorPrefix() {
        return "world." + (activeWorldKey.isEmpty() ? "default" : activeWorldKey) + ".";
    }

    private static String worldKey(MinecraftServer server) {
        String levelName = server.getWorldData().getLevelName();
        return Integer.toUnsignedString(levelName.hashCode(), 36);
    }

    private void processExternalJob() {
        Properties job = readProperties(jobConfigPath());
        String jobId = job.getProperty("jobId", "").trim();
        if (jobId.isEmpty() || jobId.equals(lastJobId)) return;

        String action = job.getProperty("action", "start").trim().toLowerCase();
        if ("stop".equals(action)) {
            lastJobId = jobId;
            activeJobId = jobId;
            stopInternal(true);
            writeStatus("stopped", "桌面程序已停止自动跑酷");
            return;
        }

        String requestedTheme = job.getProperty("theme", "random").trim().toLowerCase();
        long seed = parseLong(job.getProperty("seed", ""), System.nanoTime());
        int duration = (int) parseLong(job.getProperty("durationSeconds", "150"), 150);
        int batchIndex = (int) parseLong(job.getProperty("batchIndex", "1"), 1);
        if (startJob(jobId, requestedTheme, seed, duration, batchIndex)) lastJobId = jobId;
    }

    private static String resolveTheme(String requestedTheme, long seed) {
        String normalized = requestedTheme == null ? "random" : requestedTheme.trim().toLowerCase();
        if (CourseBuilder.isTemplateId(normalized)) return normalized;

        long mixed = mix64(seed);
        if (THEMES.contains(normalized)) {
            int variant = (int) Math.floorMod(mixed, TEMPLATE_VARIANTS_PER_THEME) + 1;
            return templateId(normalized, variant);
        }

        int templateIndex = (int) Math.floorMod(mixed, TEMPLATE_COUNT);
        String baseTheme = THEMES.get(templateIndex / TEMPLATE_VARIANTS_PER_THEME);
        int variant = templateIndex % TEMPLATE_VARIANTS_PER_THEME + 1;
        return templateId(baseTheme, variant);
    }

    private static String templateId(String baseTheme, int variant) {
        return String.format("%s-v%02d", baseTheme, variant);
    }

    private int readSelectedDuration() {
        Path config = FabricLoader.getInstance().getConfigDir().resolve("parkoursim-duration.txt");
        try {
            return Math.max(120, Math.min(900, Integer.parseInt(Files.readString(config).trim())));
        } catch (Exception ignored) {
            return 150;
        }
    }

    private void writeStatus(String state, String detail) {
        if (activeJobId.isEmpty()) return;
        Properties status = new Properties();
        status.setProperty("jobId", activeJobId);
        status.setProperty("state", state);
        status.setProperty("theme", selectedTheme);
        status.setProperty("themeName", CourseBuilder.themeName(selectedTheme));
        status.setProperty("seed", Long.toString(routeSeed));
        status.setProperty("paletteVariant", Integer.toString(variationIndex(routeSeed, 0x632BE59BD9B4E019L, 4)));
        status.setProperty("landmarkPack", Integer.toString(variationIndex(routeSeed, 0x8CB92BA72F3D8DD7L, 6)));
        status.setProperty("terrainProfile", Integer.toString(variationIndex(routeSeed, 0x9E3779B97F4A7C15L, 4)));
        status.setProperty("sceneOrderProfile", Integer.toString(variationIndex(routeSeed, 0xD1B54A32D192ED03L, 8)));
        status.setProperty("cameraProfile", Integer.toString(cameraProfile));
        status.setProperty("durationSeconds", Integer.toString(targetDurationSeconds));
        status.setProperty("builtStages", Integer.toString(builtStages));
        status.setProperty("targetStages", Integer.toString(targetStages));
        status.setProperty("elapsedSeconds", Integer.toString(elapsedRunTicks / 20));
        status.setProperty("detail", detail);
        Path path = statusPath();
        Path temp = path.resolveSibling(path.getFileName() + ".tmp");
        try {
            Files.createDirectories(path.getParent());
            Files.writeString(
                heartbeatPath(),
                activeJobId + System.lineSeparator()
                    + elapsedRunTicks / 20 + System.lineSeparator()
                    + state + System.lineSeparator()
            );
        } catch (Exception ignored) {
            // The regular status file below remains a fallback heartbeat.
        }
        try {
            Files.createDirectories(path.getParent());
            try (OutputStream output = Files.newOutputStream(temp)) {
                status.store(output, "ParkourSim director status");
            }
            try {
                Files.move(temp, path, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (Exception ignored) {
                Files.move(temp, path, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (Exception ignored) {
            // Status reporting must never interrupt the running camera.
        }
    }

    private String readStatusJobId() {
        return readProperties(statusPath()).getProperty("jobId", "").trim();
    }

    private static Properties readProperties(Path path) {
        Properties properties = new Properties();
        try (InputStream input = Files.newInputStream(path)) {
            properties.load(input);
        } catch (Exception ignored) {
            // Missing files are expected before the first desktop-controlled run.
        }
        return properties;
    }

    private static void storeProperties(Path path, Properties properties, String comment) {
        Path temp = path.resolveSibling(path.getFileName() + ".tmp");
        try {
            Files.createDirectories(path.getParent());
            try (OutputStream output = Files.newOutputStream(temp)) {
                properties.store(output, comment);
            }
            try {
                Files.move(temp, path, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (Exception ignored) {
                Files.move(temp, path, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (Exception ignored) {
            // A failed anchor write only falls back to this session's in-memory anchor.
        }
    }

    private static long parseLong(String value, long fallback) {
        try {
            return Long.parseLong(value.trim());
        } catch (Exception ignored) {
            return fallback;
        }
    }

    private static long mix64(long value) {
        long mixed = value;
        mixed = (mixed ^ (mixed >>> 30)) * 0xbf58476d1ce4e5b9L;
        mixed = (mixed ^ (mixed >>> 27)) * 0x94d049bb133111ebL;
        return mixed ^ (mixed >>> 31);
    }

    private static int variationIndex(long seed, long salt, int bound) {
        return (int) Math.floorMod(mix64(seed ^ salt), bound);
    }

    private static Path jobConfigPath() {
        return FabricLoader.getInstance().getConfigDir().resolve("parkoursim-job.properties");
    }

    private static Path statusPath() {
        return FabricLoader.getInstance().getConfigDir().resolve("parkoursim-status.properties");
    }

    private static Path heartbeatPath() {
        return FabricLoader.getInstance().getConfigDir().resolve("parkoursim-heartbeat.txt");
    }

    private static Path anchorPath() {
        return FabricLoader.getInstance().getConfigDir().resolve("parkoursim-anchor.properties");
    }

    private void buildNextBatch() {
        MinecraftServer server = client.getSingleplayerServer();
        if (server == null || plan == null) return;
        int batchSize = running ? STREAM_BUILD_BATCH : INITIAL_BUILD_BATCH;
        int end = Math.min(plan.placements().size(), buildIndex + batchSize);
        List<Placement> batch = new ArrayList<>(plan.placements().subList(buildIndex, end));
        buildIndex = end;
        ServerLevel level = server.overworld();
        server.execute(() -> {
            for (Placement placement : batch) {
                level.setBlock(placement.pos(), placement.state(), 2);
            }
        });
        if (buildIndex >= plan.placements().size()) {
            if (!plan.stages().isEmpty()) appendStage(plan.stages().get(0), plannedStage);
            builtStages++;
            plan = null;
            buildIndex = 0;
            plannedStage = -1;
            if (!running) writeStatus("building", "正在预生成开头场景");
        }
    }

    private void planNextStage() {
        if (plan != null || courseOrigin == null || nextStage >= targetStages) return;
        plannedStage = nextStage++;
        plan = CourseBuilder.planStage(courseOrigin, selectedTheme, routeSeed, plannedStage);
        buildIndex = 0;
    }

    private void appendStage(Stage stage, int globalStage) {
        routeStageNames.add(stage.name());
        for (Vec3 point : stage.waypoints()) {
            if (!routePoints.isEmpty() && routePoints.get(routePoints.size() - 1).distanceToSqr(point) < 0.0001) continue;
            routePoints.add(point);
            routeStages.add(globalStage);
        }
    }

    private void beginRun() {
        if (routePoints.size() < 2) {
            running = false;
            message("连续路线生成失败，请按 F8 重试");
            writeStatus("error", "连续路线生成失败");
            return;
        }
        running = true;
        stageIndex = routeStages.get(0);
        routeIndex = 0;
        segmentTick = 0;
        elapsedRunTicks = 0;
        if (client.options != null) {
            client.options.pauseOnLostFocus = false;
            previousFov = client.options.fov().get();
            client.options.fov().set(switch (cameraProfile) {
                case 0 -> 88;
                case 1 -> 92;
                case 2 -> 96;
                default -> 90;
            });
        }
        changedHud = !client.gui.hud.isHidden();
        if (changedHud) client.gui.hud.toggle();
        setSpectator(true);
        cameraYaw = lookYaw(routePoints.get(0), lookAhead(routePoints, 0, cameraLookAhead(WALK_LOOK_AHEAD)));
        cameraPitch = switch (cameraProfile) {
            case 0 -> 13;
            case 2 -> 18;
            case 3 -> 11;
            default -> 16;
        };
        cameraPoseInitialized = true;
        teleportTo(routePoints.get(0), cameraYaw, cameraPitch);
        writeStatus("running", "路线已就绪，开始单向自动跑酷");
        message("单向跑酷已开始：前方地图会持续生成，路线不折返；F9 停止");
    }

    private void advanceCamera() {
        if (routePoints.size() < 2) return;
        int nextIndex = routeIndex + 1;
        if (nextIndex >= routePoints.size()) {
            if (nextStage >= targetStages && plan == null) finishRun();
            return;
        }

        Vec3 from = routePoints.get(routeIndex);
        Vec3 to = routePoints.get(nextIndex);
        double horizontal = Math.hypot(to.x - from.x, to.z - from.z);
        boolean needsJump = horizontal > JUMP_DISTANCE;
        double baseSegmentTicks = Math.max(
            needsJump ? 8.0 : 3.0,
            horizontal * (needsJump ? JUMP_TICKS_PER_BLOCK : WALK_TICKS_PER_BLOCK)
        );
        double segmentTicks = baseSegmentTicks * paceFactor();
        double t = Math.min(1.0, (segmentTick + 1) / (double) segmentTicks);
        double progress = needsJump ? smoothStep(t) : t;
        double arc = needsJump ? Math.sin(Math.PI * t) * (0.82 + Math.max(0, to.y - from.y) * 0.12) : 0;
        Vec3 position = new Vec3(
            lerp(from.x, to.x, progress),
            lerp(from.y, to.y, progress) + arc,
            lerp(from.z, to.z, progress)
        );
        Vec3 lookTarget = lookAhead(
            routePoints,
            nextIndex,
            cameraLookAhead(needsJump ? JUMP_LOOK_AHEAD : WALK_LOOK_AHEAD)
        );
        float targetYaw = lookYaw(position, lookTarget);
        double lookDistance = Math.max(2.5, Math.hypot(lookTarget.x - position.x, lookTarget.z - position.z));
        double eyeToTarget = position.y + 1.45 - lookTarget.y;
        float targetPitch = (float) Math.toDegrees(Math.atan2(eyeToTarget, lookDistance));
        targetPitch = (float) Math.max(-18, Math.min(27, targetPitch));

        if (!cameraPoseInitialized) {
            cameraYaw = targetYaw;
            cameraPitch = targetPitch;
            cameraPoseInitialized = true;
        } else {
            float yawSmoothing = switch (cameraProfile) {
                case 0 -> 0.18f;
                case 2 -> 0.27f;
                case 3 -> 0.20f;
                default -> 0.22f;
            };
            float pitchSmoothing = switch (cameraProfile) {
                case 0 -> 0.13f;
                case 2 -> 0.21f;
                case 3 -> 0.15f;
                default -> 0.17f;
            };
            cameraYaw = lerpAngle(cameraYaw, targetYaw, yawSmoothing);
            cameraPitch += (targetPitch - cameraPitch) * pitchSmoothing;
        }
        teleportTo(position, cameraYaw, cameraPitch);
        elapsedRunTicks++;

        segmentTick++;
        if (segmentTick >= segmentTicks) {
            routeIndex = nextIndex;
            segmentTick = Math.max(0, segmentTick - segmentTicks);
            int nextStage = routeStages.get(routeIndex);
            if (nextStage != stageIndex) {
                stageIndex = nextStage;
                if (stageIndex >= 0 && stageIndex < routeStageNames.size()) {
                    message("连续进入：" + routeStageNames.get(stageIndex));
                }
            }
        }
    }

    private void finishRun() {
        running = false;
        writeStatus("finished", "已到达本次单向路线终点");
        message("本次单向路线已完成");
    }

    private double paceFactor() {
        return switch (CourseBuilder.baseTheme(selectedTheme)) {
            case "village", "checker", "cherry", "crystal" -> 0.88;
            case "library", "honey", "ice" -> 0.94;
            default -> 0.97;
        };
    }

    private int cameraLookAhead(int baseDistance) {
        return Math.max(3, switch (cameraProfile) {
            case 0 -> baseDistance + 2;
            case 2 -> baseDistance - 1;
            case 3 -> baseDistance + 1;
            default -> baseDistance;
        });
    }

    private void teleportTo(Vec3 position, float yaw, float pitch) {
        MinecraftServer server = client.getSingleplayerServer();
        LocalPlayer local = client.player;
        if (server == null || local == null) return;
        UUID id = local.getUUID();
        server.execute(() -> {
            ServerPlayer player = server.getPlayerList().getPlayer(id);
            if (player == null) return;
            player.connection.teleport(position.x, position.y, position.z, yaw, pitch);
        });
    }

    private void setSpectator(boolean spectator) {
        MinecraftServer server = client.getSingleplayerServer();
        LocalPlayer local = client.player;
        if (server == null || local == null) return;
        UUID id = local.getUUID();
        server.execute(() -> {
            ServerPlayer player = server.getPlayerList().getPlayer(id);
            if (player != null) player.setGameMode(spectator ? GameType.SPECTATOR : GameType.CREATIVE);
        });
    }

    private void stop() {
        if (!running && plan == null) return;
        stopInternal(true);
        writeStatus("stopped", "自动跑酷已停止");
    }

    private void stopInternal(boolean announce) {
        boolean wasActive = running || plan != null;
        running = false;
        warmupTicks = 0;
        buildIndex = 0;
        plan = null;
        routePoints.clear();
        routeStages.clear();
        routeStageNames.clear();
        routeIndex = 0;
        stageIndex = 0;
        nextStage = 0;
        builtStages = 0;
        targetStages = 0;
        plannedStage = -1;
        elapsedRunTicks = 0;
        courseOrigin = null;
        if (wasActive) {
            setSpectator(false);
            if (client != null) {
                if (changedHud && client.gui.hud.isHidden()) client.gui.hud.toggle();
                if (client.options != null) client.options.fov().set(previousFov);
            }
        }
        changedHud = false;
        if (announce && wasActive) message("自动跑酷已停止");
    }

    private void resetSession() {
        running = false;
        plan = null;
        routePoints.clear();
        routeStages.clear();
        routeStageNames.clear();
        buildIndex = 0;
        warmupTicks = 0;
        autoStarted = false;
        autoStartTicks = 0;
        f8WasDown = false;
        f9WasDown = false;
        cameraPoseInitialized = false;
        stageIndex = 0;
        routeIndex = 0;
        nextStage = 0;
        builtStages = 0;
        targetStages = 0;
        plannedStage = -1;
        elapsedRunTicks = 0;
        courseOrigin = null;
        batchAnchor = null;
        activeWorldKey = "";
    }

    private String readSelectedTheme() {
        Path config = FabricLoader.getInstance().getConfigDir().resolve("parkoursim-theme.txt");
        try {
            String value = Files.readString(config).trim().toLowerCase();
            if ("random".equals(value)) return value;
            if (THEMES.contains(value)) return value;
            if (CourseBuilder.isTemplateId(value)) return value;
        } catch (Exception ignored) {
            // The village theme is the safe first-run default.
        }
        return "village";
    }

    private void message(String text) {
        if (client != null && client.player != null) {
            client.gui.chatListener().handleSystemMessage(Component.literal("[ParkourSim] " + text), false);
        }
    }

    private static float lookYaw(Vec3 from, Vec3 to) {
        return (float) Math.toDegrees(-Math.atan2(to.x - from.x, to.z - from.z));
    }

    private static double lerp(double a, double b, double t) {
        return a + (b - a) * t;
    }

    private static double smoothStep(double t) {
        return t * t * (3.0 - 2.0 * t);
    }

    private static Vec3 lookAhead(List<Vec3> points, int index, int distance) {
        int target = index + Math.max(1, distance);
        return points.get(Math.min(points.size() - 1, Math.max(0, target)));
    }

    private static float lerpAngle(float from, float to, float amount) {
        float delta = (to - from + 540.0f) % 360.0f - 180.0f;
        return from + delta * amount;
    }
}
