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
    private static final int BUILD_BATCH = 650;
    private static final double WALK_TICKS_PER_BLOCK = 3.4;
    private static final double JUMP_TICKS_PER_BLOCK = 4.25;
    private static final double JUMP_DISTANCE = 2.5;
    private static final int PREBUILD_STAGES = 4;
    private static final int STREAM_AHEAD_STAGES = 4;
    private static final double ESTIMATED_SECONDS_PER_STAGE = 10.2;
    private static final List<String> THEMES = List.of(
        "village", "library", "lava", "lush", "checker",
        "honey", "cherry", "ice", "nether", "crystal"
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
    private String selectedTheme = "village";
    private BlockPos courseOrigin;
    private long routeSeed;
    private int targetStages;
    private int nextStage;
    private int builtStages;
    private int plannedStage = -1;
    private int elapsedRunTicks;
    private int targetDurationSeconds = 150;
    private int jobPollTicks;
    private int statusTicks;
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
        startJob("manual-" + System.currentTimeMillis(), theme, System.nanoTime(), durationSeconds);
    }

    private boolean startJob(String jobId, String requestedTheme, long seed, int durationSeconds) {
        MinecraftServer server = client == null ? null : client.getSingleplayerServer();
        LocalPlayer player = client == null ? null : client.player;
        if (server == null || player == null) return false;

        stopInternal(false);
        activeJobId = jobId;
        selectedTheme = resolveTheme(requestedTheme, seed);
        routeSeed = seed;
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

        ServerLevel level = server.overworld();
        int startX = player.getBlockX() + 192;
        int startZ = player.getBlockZ();
        int terrainY = level.getHeight(Heightmap.Types.MOTION_BLOCKING_NO_LEAVES, startX, startZ);
        int startY = Math.max(-40, Math.min(220, terrainY + 2));
        courseOrigin = new BlockPos(startX, startY, startZ);

        planNextStage();
        writeStatus("building", "正在预生成开头场景，录制将在路线就绪后自动开始");
        message("正在生成新路线：" + CourseBuilder.themeName(selectedTheme)
            + "，种子 " + routeSeed + "，约 " + targetDurationSeconds / 60 + " 分钟");
        return true;
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
        if (startJob(jobId, requestedTheme, seed, duration)) lastJobId = jobId;
    }

    private static String resolveTheme(String requestedTheme, long seed) {
        if (THEMES.contains(requestedTheme)) return requestedTheme;
        return THEMES.get(Math.floorMod((int) mix64(seed), THEMES.size()));
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
        status.setProperty("durationSeconds", Integer.toString(targetDurationSeconds));
        status.setProperty("builtStages", Integer.toString(builtStages));
        status.setProperty("targetStages", Integer.toString(targetStages));
        status.setProperty("elapsedSeconds", Integer.toString(elapsedRunTicks / 20));
        status.setProperty("detail", detail);
        Path path = statusPath();
        Path temp = path.resolveSibling(path.getFileName() + ".tmp");
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

    private static Path jobConfigPath() {
        return FabricLoader.getInstance().getConfigDir().resolve("parkoursim-job.properties");
    }

    private static Path statusPath() {
        return FabricLoader.getInstance().getConfigDir().resolve("parkoursim-status.properties");
    }

    private void buildNextBatch() {
        MinecraftServer server = client.getSingleplayerServer();
        if (server == null || plan == null) return;
        int end = Math.min(plan.placements().size(), buildIndex + BUILD_BATCH);
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
            client.options.fov().set(92);
        }
        changedHud = !client.gui.hud.isHidden();
        if (changedHud) client.gui.hud.toggle();
        setSpectator(true);
        cameraYaw = lookYaw(routePoints.get(0), lookAhead(routePoints, 0, 1));
        cameraPitch = 16;
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
        double segmentTicks = Math.max(
            needsJump ? 8.0 : 3.0,
            horizontal * (needsJump ? JUMP_TICKS_PER_BLOCK : WALK_TICKS_PER_BLOCK)
        );
        double t = Math.min(1.0, (segmentTick + 1) / (double) segmentTicks);
        double progress = needsJump ? smoothStep(t) : t;
        double arc = needsJump ? Math.sin(Math.PI * t) * (0.82 + Math.max(0, to.y - from.y) * 0.12) : 0;
        Vec3 position = new Vec3(
            lerp(from.x, to.x, progress),
            lerp(from.y, to.y, progress) + arc,
            lerp(from.z, to.z, progress)
        );
        Vec3 lookTarget = lookAhead(routePoints, nextIndex, 1);
        float targetYaw = lookYaw(position, lookTarget);
        double lookDistance = Math.max(2.5, Math.hypot(lookTarget.x - position.x, lookTarget.z - position.z));
        double eyeToTarget = position.y + 1.45 - lookTarget.y;
        float targetPitch = (float) Math.toDegrees(Math.atan2(eyeToTarget, lookDistance));
        targetPitch = (float) Math.max(-24, Math.min(34, targetPitch));

        if (!cameraPoseInitialized) {
            cameraYaw = targetYaw;
            cameraPitch = targetPitch;
            cameraPoseInitialized = true;
        } else {
            cameraYaw = lerpAngle(cameraYaw, targetYaw, 0.28f);
            cameraPitch += (targetPitch - cameraPitch) * 0.20f;
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
    }

    private String readSelectedTheme() {
        Path config = FabricLoader.getInstance().getConfigDir().resolve("parkoursim-theme.txt");
        try {
            String value = Files.readString(config).trim().toLowerCase();
            if ("random".equals(value)) return value;
            if (THEMES.contains(value)) return value;
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

    private static Vec3 lookAhead(List<Vec3> points, int index, int direction) {
        int target = index + direction * 3;
        return points.get(Math.min(points.size() - 1, Math.max(0, target)));
    }

    private static float lerpAngle(float from, float to, float amount) {
        float delta = (to - from + 540.0f) % 360.0f - 180.0f;
        return from + delta * amount;
    }
}
