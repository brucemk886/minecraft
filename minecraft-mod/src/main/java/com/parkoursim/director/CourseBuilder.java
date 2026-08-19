package com.parkoursim.director;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import net.minecraft.core.BlockPos;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.Vec3;

import com.parkoursim.director.CoursePlan.Placement;
import com.parkoursim.director.CoursePlan.Stage;

public final class CourseBuilder {
    public static final int STAGE_LENGTH = 48;
    private static final int TURN_SEGMENT_LENGTH = 24;
    private static final int KEYFRAME_SPACING = 8;
    private static final int HEIGHT_KEYFRAME_SPACING = 6;
    private static final int SUBSCENES_PER_THEME = 8;
    private static final int[][] SUBSCENE_ORDERS = {
        {0, 1, 2, 3, 4, 5, 6, 7},
        {0, 2, 1, 4, 3, 6, 5, 7},
        {0, 3, 1, 5, 2, 6, 4, 7},
        {0, 1, 4, 2, 5, 3, 6, 7},
        {0, 4, 1, 3, 2, 5, 6, 7},
        {0, 2, 4, 1, 5, 3, 6, 7},
        {0, 3, 2, 4, 1, 6, 5, 7},
        {0, 1, 3, 5, 2, 4, 6, 7}
    };
    private static final int[] SAFE_GAP_CANDIDATES = {7, 10, 13, 16, 29, 32, 35, 38, 41};
    private static final List<String> BASE_THEMES = List.of(
        "village", "library", "lava", "lush", "checker", "honey",
        "cherry", "ice", "nether", "crystal", "desert", "bamboo",
        "ocean", "mushroom", "copper", "redstone", "quartz", "castle",
        "melon", "coral", "rainbow", "swamp", "birch", "azalea",
        "obsidian", "gold", "emerald", "factory", "arcade", "savanna",
        "alpine", "jungle", "coast", "oasis", "candy", "clockwork",
        "marble", "vineyard", "pumpkin", "aquarium", "railway", "harbor",
        "cathedral", "dojo", "oriental", "mesa", "quarry", "greenhouse",
        "carnival", "laboratory", "music", "bakery", "volcano", "lagoon",
        "autumn", "winter", "dragon", "maze", "observatory", "stadium"
    );
    private record ThemePalette(
        Block ground,
        Block path,
        Block frame,
        Block panel,
        Block accent,
        Block light,
        String name
    ) {}
    private final Map<BlockPos, BlockState> blocks = new LinkedHashMap<>();
    private final List<Stage> stages = new ArrayList<>();
    private final int originX;
    private final int originZ;
    private final int baseY;
    private final int routeLimit;
    private final String baseTheme;
    private final int templateVariant;
    private final long seed;
    private final int paletteVariant;
    private final int landmarkPack;
    private final int terrainProfile;
    private final int sceneOrderProfile;
    private final Map<Integer, int[]> xProfiles = new HashMap<>();
    private final Map<Integer, int[]> heightProfiles = new HashMap<>();
    private final Map<Integer, int[]> gapProfiles = new HashMap<>();

    private CourseBuilder(BlockPos playerOrigin, String theme, long seed) {
        originX = playerOrigin.getX();
        originZ = playerOrigin.getZ();
        baseY = Math.max(-48, Math.min(240, playerOrigin.getY()));
        this.baseTheme = baseTheme(theme);
        this.templateVariant = templateVariant(theme);
        this.seed = seed;
        this.paletteVariant = (int) Math.floorMod(mix64(seed ^ 0x632BE59BD9B4E019L), 4);
        this.landmarkPack = (int) Math.floorMod(mix64(seed ^ 0x8CB92BA72F3D8DD7L), 6);
        this.terrainProfile = (int) Math.floorMod(mix64(seed ^ 0x9E3779B97F4A7C15L), 4);
        this.sceneOrderProfile = (int) Math.floorMod(mix64(seed ^ 0xD1B54A32D192ED03L), 8);
        int baseRouteLimit = switch (this.baseTheme) {
            case "lava", "nether" -> 3;
            case "honey", "cherry" -> 4;
            default -> 5;
        };
        int routeModifier = switch (this.templateVariant) {
            case 2, 7, 10 -> 1;
            case 4, 9 -> -1;
            default -> 0;
        };
        routeLimit = Math.max(2, Math.min(6, baseRouteLimit + routeModifier));
    }

    public static CoursePlan plan(BlockPos playerOrigin, String theme) {
        CourseBuilder builder = new CourseBuilder(playerOrigin, theme, 0L);
        for (int stage = 0; stage < 10; stage++) builder.clearKnownDecorations(stage);
        for (int stage = 0; stage < 10; stage++) builder.foundation(stage);
        for (int stage = 0; stage < 10; stage++) builder.buildTheme(theme, stage);
        builder.protectRoute(theme, 0, 10);
        List<Placement> placements = builder.blocks.entrySet().stream()
            .map(entry -> new Placement(entry.getKey(), entry.getValue()))
            .toList();
        return new CoursePlan(placements, List.copyOf(builder.stages));
    }

    public static CoursePlan planStage(BlockPos playerOrigin, String theme, long seed, int stage) {
        CourseBuilder builder = new CourseBuilder(playerOrigin, theme, seed);
        builder.clearKnownDecorations(stage);
        builder.foundation(stage);
        builder.buildTheme(theme, stage);
        int protectedStart = Math.max(0, stage - 1);
        builder.protectRoute(theme, protectedStart, stage - protectedStart + 1);
        List<Placement> placements = builder.blocks.entrySet().stream()
            .map(entry -> new Placement(entry.getKey(), entry.getValue()))
            .toList();
        return new CoursePlan(placements, List.copyOf(builder.stages));
    }

    public static boolean isTemplateId(String theme) {
        if (theme == null) return false;
        String normalized = theme.trim().toLowerCase();
        int separator = normalized.lastIndexOf("-v");
        if (separator <= 0 || !normalized.substring(separator + 2).matches("0[1-5]")) return false;
        return BASE_THEMES.contains(normalized.substring(0, separator));
    }

    public static String baseTheme(String theme) {
        String normalized = theme == null ? "" : theme.trim().toLowerCase();
        String candidate = isTemplateId(normalized) ? normalized.substring(0, normalized.length() - 4) : normalized;
        return BASE_THEMES.contains(candidate) ? candidate : "village";
    }

    public static int templateVariant(String theme) {
        if (!isTemplateId(theme)) return 1;
        String normalized = theme.trim().toLowerCase();
        return Integer.parseInt(normalized.substring(normalized.length() - 2));
    }

    public static String themeName(String theme) {
        String baseName = switch (baseTheme(theme)) {
            case "library" -> "高层图书馆";
            case "lava" -> "熔岩峡谷";
            case "lush" -> "繁茂洞穴";
            case "checker" -> "红白花园";
            case "honey" -> "蜂巢矿洞";
            case "cherry" -> "樱花高塔";
            case "ice" -> "冰晶宫殿";
            case "nether" -> "下界熔炉";
            case "crystal" -> "紫晶花园";
            case "desert" -> "沙漠神殿";
            case "bamboo" -> "竹林寺院";
            case "ocean" -> "海晶神殿";
            case "mushroom" -> "蘑菇乐园";
            case "copper" -> "铜艺工厂";
            case "redstone" -> "红石机械城";
            case "quartz" -> "白石圣殿";
            case "castle" -> "石砖王城";
            case "melon" -> "西瓜农庄";
            case "coral" -> "珊瑚水庭";
            case "rainbow" -> "彩虹玻璃城";
            case "swamp" -> "红树林水寨";
            case "birch" -> "白桦林庄园";
            case "azalea" -> "杜鹃花庭院";
            case "obsidian" -> "黑曜石要塞";
            case "gold" -> "黄金宫殿";
            case "emerald" -> "翡翠神殿";
            case "factory" -> "蒸汽工厂";
            case "arcade" -> "霓虹游戏厅";
            case "savanna" -> "热带草原城";
            case "alpine" -> "高山木屋";
            case "jungle" -> "丛林神庙";
            case "coast" -> "海岸堡垒";
            case "oasis" -> "绿洲城邦";
            case "candy" -> "糖果工坊";
            case "clockwork" -> "钟表机械城";
            case "marble" -> "大理石浴场";
            case "vineyard" -> "葡萄庄园";
            case "pumpkin" -> "南瓜嘉年华";
            case "aquarium" -> "水族长廊";
            case "railway" -> "蒸汽铁路";
            case "harbor" -> "海港船坞";
            case "cathedral" -> "彩窗教堂";
            case "dojo" -> "武道庭院";
            case "oriental" -> "东方宫殿";
            case "mesa" -> "彩陶峡谷";
            case "quarry" -> "石料矿场";
            case "greenhouse" -> "玻璃温室";
            case "carnival" -> "嘉年华乐园";
            case "laboratory" -> "晶能实验室";
            case "music" -> "音乐殿堂";
            case "bakery" -> "烘焙工坊";
            case "volcano" -> "火山神殿";
            case "lagoon" -> "热带泻湖";
            case "autumn" -> "秋叶庄园";
            case "winter" -> "冬日村镇";
            case "dragon" -> "龙纹圣殿";
            case "maze" -> "花园迷宫";
            case "observatory" -> "星象大厅";
            case "stadium" -> "竞技场";
            default -> "村庄花园";
        };
        int variant = templateVariant(theme);
        String style = switch (variant) {
            case 2 -> "急弯回廊";
            case 3 -> "高低阶梯";
            case 4 -> "开阔庭院";
            case 5 -> "连续拱门";
            default -> "经典长廊";
        };
        return baseName + " · " + String.format("%02d", variant) + " " + style;
    }

    private void buildTheme(String theme, int stage) {
        String normalizedTheme = baseTheme(theme);
        int subscene = subsceneIndex(stage);
        switch (normalizedTheme) {
            case "library" -> library(stage);
            case "lava" -> lavaCanyon(stage);
            case "lush" -> lushCave(stage);
            case "checker" -> checkerGarden(stage);
            case "honey" -> honeyMine(stage);
            case "cherry" -> sunsetTower(stage);
            case "ice" -> icePalace(stage);
            case "nether" -> netherForge(stage);
            case "crystal" -> crystalGarden(stage);
            case "village" -> village(stage);
            default -> themedGallery(stage, normalizedTheme, subscene);
        }
        decorateThemeSubscene(stage, normalizedTheme, subscene);
        renameLatestStage(normalizedTheme, subscene);
        decorateTemplateVariant(stage);
    }

    private void foundation(int stage) {
        int startZ = stageZ(stage);
        int endZ = startZ + STAGE_LENGTH;
        for (int z = startZ; z <= endZ; z++) {
            for (int x = -14; x <= 14; x++) {
                for (int depth = 8; depth >= 2; depth--) {
                    Block material = depth == 2 ? Blocks.DIRT : Blocks.STONE;
                    put(x, baseY - depth, z, material);
                }
            }
        }
    }

    private void village(int stage) {
        int oz = stageZ(stage);
        int scene = Math.floorMod(sceneIndex(stage), 5);
        Block path = villagePath(stage);
        for (int localZ = 0; localZ <= STAGE_LENGTH; localZ++) {
            int z = oz + localZ;
            for (int x = -11; x <= 11; x++) {
                put(x, baseY - 2, z, Blocks.DIRT);
                put(x, baseY - 1, z, Math.abs(x - courseX(z)) < 2 ? Blocks.DIRT_PATH : Blocks.GRASS_BLOCK);
            }
        }
        int treeStep = scene == 3 ? 8 : 12;
        for (int localZ = 5; localZ <= STAGE_LENGTH - 5; localZ += treeStep) {
            int side = ((localZ / treeStep + scene) & 1) == 0 ? -1 : 1;
            tree(side * (scene == 3 ? 6 : 8), baseY, oz + localZ);
        }
        switch (scene) {
            case 0 -> {
                house(-11, baseY, oz + 8);
                house(7, baseY, oz + 30);
            }
            case 1 -> {
                house(-11, baseY, oz + 20);
                for (int localZ : new int[] {7, 23, 39}) lamp(localZ == 23 ? -5 : 5, baseY, oz + localZ);
            }
            case 2 -> {
                routeArch(stage, 10, Blocks.COBBLESTONE, Blocks.GLOWSTONE);
                routeArch(stage, 34, Blocks.STONE_BRICKS, Blocks.SEA_LANTERN);
            }
            case 3 -> {
                for (int localZ : new int[] {4, 16, 28, 40}) lamp((localZ / 12 & 1) == 0 ? -5 : 5, baseY, oz + localZ);
            }
            default -> {
                house(-11, baseY, oz + 28);
                entryArch(oz + 7, Blocks.OAK_LOG, Blocks.GLOWSTONE);
                entryArch(oz + 41, Blocks.COBBLESTONE, Blocks.SEA_LANTERN);
            }
        }
        addPath(villageSectionName(stage), stage, path);
    }

    private Block villagePath(int stage) {
        return switch (Math.floorMod(sceneIndex(stage), 5)) {
            case 1 -> Blocks.OAK_PLANKS;
            case 2 -> Blocks.COBBLESTONE;
            case 4 -> Blocks.STONE_BRICKS;
            default -> Blocks.MOSS_BLOCK;
        };
    }

    private String villageSectionName(int stage) {
        String section = switch (Math.floorMod(sceneIndex(stage), 5)) {
            case 1 -> "集市木栈道";
            case 2 -> "石桥水渠";
            case 3 -> "灯笼果园";
            case 4 -> "村口拱门";
            default -> "屋顶花园";
        };
        return "村庄花园 · " + section;
    }

    private void library(int stage) {
        int oz = stageZ(stage);
        int scene = sceneIndex(stage);
        int ceilingHeight = switch (scene) {
            case 2, 3, 7, 9 -> 16;
            case 0, 1, 6 -> 14;
            default -> 13;
        };
        Block frame = libraryFrame(scene);
        Block panel = libraryPanel(scene);
        Block light = scene % 3 == 1 ? Blocks.GLOWSTONE : Blocks.SEA_LANTERN;
        for (int localZ = 0; localZ <= STAGE_LENGTH; localZ++) {
            int z = oz + localZ;
            Block floor = libraryFloor(scene, localZ / 12);
            for (int x = -8; x <= 8; x++) {
                put(x, baseY - 1, z, floor);
                boolean skylight = (scene == 6 || scene == 9) && Math.abs(x) <= 3 && localZ % 12 >= 3;
                put(x, baseY + ceilingHeight, z, skylight ? Blocks.GLASS : panel);
            }
            for (int y = 0; y < ceilingHeight; y++) {
                boolean windowBand = (scene == 3 || scene == 6 || scene == 9)
                    && y >= 3 && y <= ceilingHeight - 3 && localZ % 16 >= 3 && localZ % 16 <= 11;
                boolean shelfBand = y >= 1 && y <= ceilingHeight - 2 && (y + scene) % 4 != 0;
                Block wall = windowBand
                    ? Blocks.GLASS
                    : y == 0 || y == ceilingHeight - 1 || localZ % 8 == 0 ? frame : shelfBand ? Blocks.BOOKSHELF : panel;
                put(-8, baseY + y, z, wall);
                put(8, baseY + y, z, wall);
            }
            if (localZ % 12 == 6) put(courseX(z), baseY + ceilingHeight - 2, z, light);
        }
        decorateLibrarySegment(stage, scene, oz, ceilingHeight);
        addPath(librarySectionName(scene), stage, libraryPath(scene));
    }

    private Block libraryFrame(int stage) {
        return switch (stage) {
            case 2, 5 -> Blocks.STONE_BRICKS;
            case 3 -> Blocks.CHERRY_LOG;
            case 4, 8 -> Blocks.DEEPSLATE_BRICKS;
            case 6, 9 -> Blocks.QUARTZ_PILLAR;
            case 1 -> Blocks.SPRUCE_LOG;
            default -> Blocks.DARK_OAK_LOG;
        };
    }

    private Block libraryPanel(int stage) {
        return switch (stage) {
            case 2 -> Blocks.STONE_BRICKS;
            case 3 -> Blocks.CHERRY_PLANKS;
            case 4 -> Blocks.DEEPSLATE_BRICKS;
            case 5 -> Blocks.CRACKED_STONE_BRICKS;
            case 6, 9 -> Blocks.QUARTZ_BLOCK;
            case 8 -> Blocks.SPRUCE_PLANKS;
            default -> Blocks.DARK_OAK_PLANKS;
        };
    }

    private Block libraryFloor(int stage, int band) {
        Block first = switch (stage) {
            case 2, 5 -> Blocks.STONE_BRICKS;
            case 3 -> Blocks.CHERRY_PLANKS;
            case 4 -> Blocks.DEEPSLATE_BRICKS;
            case 6, 9 -> Blocks.QUARTZ_BLOCK;
            case 1, 8 -> Blocks.SPRUCE_PLANKS;
            default -> Blocks.OAK_PLANKS;
        };
        Block second = switch (stage) {
            case 2, 5 -> Blocks.DARK_OAK_PLANKS;
            case 3 -> Blocks.QUARTZ_BLOCK;
            case 4 -> Blocks.SPRUCE_PLANKS;
            case 6, 9 -> Blocks.CHERRY_PLANKS;
            default -> Blocks.DARK_OAK_PLANKS;
        };
        return (band & 1) == 0 ? first : second;
    }

    private Block libraryPath(int stage) {
        return switch (stage) {
            case 2, 5 -> Blocks.STONE_BRICKS;
            case 3 -> Blocks.CHERRY_PLANKS;
            case 4 -> Blocks.POLISHED_DEEPSLATE;
            case 6, 9 -> Blocks.QUARTZ_BLOCK;
            case 1, 8 -> Blocks.SPRUCE_PLANKS;
            default -> Blocks.OAK_PLANKS;
        };
    }

    private void decorateLibrarySegment(int stage, int scene, int oz, int ceilingHeight) {
        switch (scene) {
            case 0 -> {
                routeArch(stage, 8, Blocks.DARK_OAK_LOG, Blocks.SEA_LANTERN);
                routeArch(stage, 24, Blocks.DARK_OAK_LOG, Blocks.SEA_LANTERN);
                routeArch(stage, 40, Blocks.DARK_OAK_LOG, Blocks.SEA_LANTERN);
                readingDesk(stage, 16);
                readingDesk(stage, 33);
            }
            case 1 -> {
                for (int localZ : new int[] {6, 13, 20, 27, 34, 41}) shelfWing(stage, localZ, (localZ / 7 & 1) == 0);
                routeArch(stage, 45, Blocks.SPRUCE_LOG, Blocks.GLOWSTONE);
            }
            case 2 -> {
                sideBalcony(oz, 4, Blocks.DARK_OAK_PLANKS);
                sideBalcony(oz, 7, Blocks.SPRUCE_PLANKS);
                routeArch(stage, 10, Blocks.DARK_OAK_LOG, Blocks.SEA_LANTERN);
                routeArch(stage, 30, Blocks.DARK_OAK_LOG, Blocks.SEA_LANTERN);
                hangingLight(stage, 20, ceilingHeight);
                hangingLight(stage, 40, ceilingHeight);
            }
            case 3 -> {
                for (int localZ : new int[] {7, 16, 27, 38}) readingDesk(stage, localZ);
                routeArch(stage, 12, Blocks.STRIPPED_DARK_OAK_LOG, Blocks.SEA_LANTERN);
                routeArch(stage, 36, Blocks.STRIPPED_DARK_OAK_LOG, Blocks.SEA_LANTERN);
            }
            case 4 -> {
                for (int localZ : new int[] {5, 11, 17, 23, 29, 35, 41}) shelfWing(stage, localZ, (localZ / 6 & 1) == 0);
                for (int localZ = 4; localZ < STAGE_LENGTH; localZ += 8) overheadBeam(oz + localZ, baseY + 6, Blocks.DARK_OAK_LOG);
            }
            case 5 -> {
                routeArch(stage, 6, Blocks.CRACKED_STONE_BRICKS, Blocks.GLOWSTONE);
                routeArch(stage, 27, Blocks.DARK_OAK_LOG, Blocks.SEA_LANTERN);
                routeArch(stage, 45, Blocks.CRACKED_STONE_BRICKS, Blocks.GLOWSTONE);
                shelfWing(stage, 14, true);
                shelfWing(stage, 30, false);
            }
            case 6 -> {
                routeArch(stage, 12, Blocks.QUARTZ_PILLAR, Blocks.SEA_LANTERN);
                routeArch(stage, 36, Blocks.QUARTZ_PILLAR, Blocks.SEA_LANTERN);
                for (int localZ : new int[] {7, 23, 39}) readingDesk(stage, localZ);
            }
            case 7 -> {
                sideBalcony(oz, 4, Blocks.DARK_OAK_PLANKS);
                sideBalcony(oz, 8, Blocks.SPRUCE_PLANKS);
                routeArch(stage, 9, Blocks.DARK_OAK_LOG, Blocks.SEA_LANTERN);
                routeArch(stage, 25, Blocks.DARK_OAK_LOG, Blocks.SEA_LANTERN);
                routeArch(stage, 41, Blocks.DARK_OAK_LOG, Blocks.SEA_LANTERN);
            }
            case 8 -> {
                for (int localZ = 3; localZ < STAGE_LENGTH; localZ += 6) overheadBeam(oz + localZ, baseY + 6, Blocks.STRIPPED_SPRUCE_LOG);
                shelfWing(stage, 12, true);
                shelfWing(stage, 24, false);
                shelfWing(stage, 36, true);
            }
            default -> {
                routeArch(stage, 8, Blocks.QUARTZ_PILLAR, Blocks.SEA_LANTERN);
                routeArch(stage, 24, Blocks.DARK_OAK_LOG, Blocks.SEA_LANTERN);
                routeArch(stage, 40, Blocks.QUARTZ_PILLAR, Blocks.SEA_LANTERN);
                hangingLight(stage, 16, ceilingHeight);
                hangingLight(stage, 32, ceilingHeight);
            }
        }
    }

    private String librarySectionName(int stage) {
        String section = switch (stage) {
            case 0 -> "迎宾大厅";
            case 1 -> "书架迷宫";
            case 2 -> "阶梯中庭";
            case 3 -> "阅览长廊";
            case 4 -> "狭窄档案室";
            case 5 -> "断层书库";
            case 6 -> "高窗画廊";
            case 7 -> "环形露台";
            case 8 -> "阁楼藏书间";
            default -> "穹顶出口厅";
        };
        return "高层图书馆 · " + section;
    }

    private void routeArch(int stage, int localZ, Block frame, Block light) {
        int z = stageZ(stage) + localZ;
        int center = courseX(z);
        int left = Math.max(-7, center - 3);
        int right = Math.min(7, center + 4);
        int top = baseY + Math.max(7, pathHeight(stage, localZ) + 5);
        for (int y = baseY; y <= top; y++) {
            put(left, y, z, frame);
            put(right, y, z, frame);
        }
        for (int x = left; x <= right; x++) put(x, top, z, frame);
        put(left + 1, top - 1, z, light);
        put(right - 1, top - 1, z, light);
    }

    private void shelfWing(int stage, int localZ, boolean fromLeft) {
        int z = stageZ(stage) + localZ;
        int center = courseX(z);
        int start = fromLeft ? -7 : center + 4;
        int end = fromLeft ? center - 3 : 7;
        for (int x = start; x <= end; x++) {
            for (int y = 0; y <= 4; y++) {
                put(x, baseY + y, z, y == 4 ? Blocks.SEA_LANTERN : Blocks.BOOKSHELF);
            }
        }
    }

    private void readingDesk(int stage, int localZ) {
        int z = stageZ(stage) + localZ;
        int center = courseX(z);
        for (int x : new int[] {center - 3, center + 4}) {
            if (x <= -8 || x >= 8) continue;
            put(x, baseY, z, Blocks.SPRUCE_PLANKS);
            put(x, baseY + 1, z, Blocks.SEA_LANTERN);
            put(x, baseY, z + 1, Blocks.DARK_OAK_FENCE);
        }
    }

    private void sideBalcony(int oz, int height, Block floor) {
        for (int localZ = 0; localZ <= STAGE_LENGTH; localZ++) {
            int z = oz + localZ;
            for (int x : new int[] {-7, 7}) put(x, baseY + height, z, floor);
            if (localZ % 3 == 0) {
                put(-7, baseY + height + 1, z, Blocks.DARK_OAK_FENCE);
                put(7, baseY + height + 1, z, Blocks.DARK_OAK_FENCE);
            }
        }
    }

    private void hangingLight(int stage, int localZ, int ceilingHeight) {
        int z = stageZ(stage) + localZ;
        int x = courseX(z);
        for (int y = ceilingHeight - 3; y < ceilingHeight; y++) put(x, baseY + y, z, Blocks.DARK_OAK_FENCE);
        put(x, baseY + ceilingHeight - 4, z, Blocks.SEA_LANTERN);
    }

    private void overheadBeam(int z, int y, Block frame) {
        for (int x = -7; x <= 7; x++) put(x, y, z, frame);
        put(-5, y - 1, z, Blocks.SEA_LANTERN);
        put(5, y - 1, z, Blocks.SEA_LANTERN);
    }

    private void lavaCanyon(int stage) {
        int oz = stageZ(stage);
        for (int localZ = 0; localZ <= STAGE_LENGTH; localZ++) {
            int z = oz + localZ;
            Block wall = lavaWall(stage);
            Block accent = lavaAccent(stage);
            for (int x = -12; x <= 12; x++) {
                if (Math.abs(x) <= 8) {
                    put(x, baseY - 5, z, localZ % 16 == 0 ? Blocks.GLOWSTONE : accent);
                    put(x, baseY - 4, z, Math.abs(x) <= 7 ? Blocks.LAVA : Blocks.MAGMA_BLOCK);
                    for (int y = -3; y <= 12; y++) put(x, baseY + y, z, Blocks.AIR);
                    continue;
                }
                int height = 11 + Math.floorMod(x * 7 + localZ * 3 + stage, 6);
                for (int y = -4; y <= height; y++) {
                    Block type = (y + localZ) % 7 == 0 || (localZ % 12 == 0 && y % 2 == 0)
                        ? accent
                        : wall;
                    put(x, baseY + y, z, type);
                }
            }
        }
        for (int localZ : new int[] {12 + seededInt(stage, 510, 5) - 2, 36 + seededInt(stage, 511, 5) - 2}) {
            lavaGateway(stage, localZ, lavaAccent(stage));
        }
        decorateLavaSegment(stage);
        addPath(lavaSectionName(stage), stage, lavaPath(stage));
    }

    private Block lavaWall(int stage) {
        return switch (sceneIndex(stage)) {
            case 0 -> Blocks.SANDSTONE;
            case 1 -> Blocks.RED_SANDSTONE;
            case 2 -> Blocks.STONE_BRICKS;
            case 3 -> Blocks.POLISHED_BLACKSTONE_BRICKS;
            case 4 -> Blocks.DEEPSLATE_BRICKS;
            case 5 -> Blocks.RED_NETHER_BRICKS;
            case 6 -> Blocks.SMOOTH_BASALT;
            case 7 -> Blocks.OBSIDIAN;
            case 8 -> Blocks.NETHERRACK;
            default -> Blocks.QUARTZ_BRICKS;
        };
    }

    private Block lavaAccent(int stage) {
        return switch (sceneIndex(stage)) {
            case 0 -> Blocks.CHISELED_SANDSTONE;
            case 1 -> Blocks.CHISELED_RED_SANDSTONE;
            case 2 -> Blocks.CRACKED_STONE_BRICKS;
            case 3 -> Blocks.GILDED_BLACKSTONE;
            case 4 -> Blocks.POLISHED_DEEPSLATE;
            case 5 -> Blocks.NETHER_WART_BLOCK;
            case 6 -> Blocks.MAGMA_BLOCK;
            case 7 -> Blocks.CRYING_OBSIDIAN;
            case 8 -> Blocks.SHROOMLIGHT;
            default -> Blocks.CHISELED_QUARTZ_BLOCK;
        };
    }

    private Block lavaPath(int stage) {
        return switch (Math.floorMod(sceneIndex(stage), 4)) {
            case 0 -> Blocks.SMOOTH_RED_SANDSTONE;
            case 1 -> Blocks.CUT_RED_SANDSTONE;
            case 2 -> Blocks.SMOOTH_SANDSTONE;
            default -> Blocks.RED_SANDSTONE;
        };
    }

    private void lavaGateway(int stage, int localZ, Block frame) {
        int z = stageZ(stage) + localZ;
        int center = courseX(z);
        int floorY = baseY - 1 + pathHeight(stage, localZ);
        int left = center - 5;
        int right = center + 6;
        int top = floorY + 9;
        for (int y = baseY - 3; y <= top; y++) {
            put(left, y, z, (y - baseY) % 8 == 0 ? Blocks.MAGMA_BLOCK : frame);
            put(right, y, z, (y - baseY) % 8 == 0 ? Blocks.MAGMA_BLOCK : frame);
        }
        for (int x = left; x <= right; x++) put(x, top, z, frame);
        put(left + 1, top - 1, z, Blocks.SHROOMLIGHT);
        put(right - 1, top - 1, z, Blocks.SHROOMLIGHT);
    }

    private void decorateLavaSegment(int stage) {
        Block body;
        Block detail;
        switch (sceneIndex(stage)) {
            case 0 -> {
                body = Blocks.CHISELED_SANDSTONE;
                detail = Blocks.GOLD_BLOCK;
            }
            case 1 -> {
                body = Blocks.CHISELED_RED_SANDSTONE;
                detail = Blocks.GOLD_BLOCK;
            }
            case 2 -> {
                body = Blocks.STONE_BRICKS;
                detail = Blocks.IRON_BLOCK;
            }
            case 3 -> {
                body = Blocks.POLISHED_BLACKSTONE_BRICKS;
                detail = Blocks.GILDED_BLACKSTONE;
            }
            case 4 -> {
                body = Blocks.POLISHED_DEEPSLATE;
                detail = Blocks.GOLD_ORE;
            }
            case 5 -> {
                body = Blocks.CRIMSON_STEM;
                detail = Blocks.NETHER_WART_BLOCK;
            }
            case 6 -> {
                body = Blocks.SMOOTH_BASALT;
                detail = Blocks.MAGMA_BLOCK;
            }
            case 7 -> {
                body = Blocks.OBSIDIAN;
                detail = Blocks.CRYING_OBSIDIAN;
            }
            case 8 -> {
                body = Blocks.NETHERRACK;
                detail = Blocks.SHROOMLIGHT;
            }
            default -> {
                body = Blocks.QUARTZ_PILLAR;
                detail = Blocks.GOLD_BLOCK;
            }
        }
        lavaSideTower(stage, 14 + seededInt(stage, 520, 7) - 3, -1, body, detail);
        lavaSideTower(stage, 35 + seededInt(stage, 521, 7) - 3, 1, body, detail);
    }

    private void lavaSideTower(int stage, int localZ, int side, Block body, Block detail) {
        int z = stageZ(stage) + localZ;
        int center = courseX(z);
        int x = center + (side < 0 ? -6 : 7);
        int top = baseY + Math.max(8, pathHeight(stage, localZ) + 6);
        for (int y = baseY - 3; y <= top; y++) {
            put(x, y, z, (y - baseY) % 5 == 0 ? detail : body);
        }
        for (int dx = -1; dx <= 1; dx++) {
            put(x + dx, top, z, detail);
        }
        put(x, top + 1, z, Blocks.SHROOMLIGHT);
    }

    private String lavaSectionName(int stage) {
        String section = switch (sceneIndex(stage)) {
            case 0 -> "砂岩神庙";
            case 1 -> "赤砂回廊";
            case 2 -> "破碎石桥";
            case 3 -> "黑石熔炉";
            case 4 -> "深板岩矿井";
            case 5 -> "下界祭坛";
            case 6 -> "玄武岩断崖";
            case 7 -> "黑曜石深坑";
            case 8 -> "熔岩水道";
            default -> "火山出口";
        };
        return "熔岩峡谷 · " + section;
    }

    private void lushCave(int stage) {
        int oz = stageZ(stage);
        int scene = Math.floorMod(sceneIndex(stage), 5);
        int wallStart = scene == 1 ? 9 : scene == 3 ? 6 : 7;
        int wallTop = scene == 2 ? 13 : scene == 1 ? 7 : 10;
        for (int localZ = 0; localZ <= STAGE_LENGTH; localZ++) {
            int z = oz + localZ;
            for (int x = -10; x <= 10; x++) {
                Block channel = scene == 4 ? Blocks.PACKED_ICE : Blocks.BLUE_ICE;
                put(x, baseY - 4, z, Math.abs(x) < 4 ? channel : Blocks.MOSS_BLOCK);
                if (Math.abs(x) < 5) {
                    for (int y = -3; y <= -1; y++) put(x, baseY + y, z, Blocks.AIR);
                }
                int edge = Math.abs(x);
                boolean openGrotto = scene == 1 && localZ % 20 >= 5 && localZ % 20 <= 14;
                if (!openGrotto && edge >= wallStart) {
                    for (int y = -3; y <= wallTop; y++) {
                        Block type = (x + y + localZ + scene) % (scene == 2 ? 6 : 9) == 0
                            ? Blocks.MOSS_BLOCK
                            : scene == 4 ? Blocks.CALCITE : Blocks.DEEPSLATE;
                        put(x, baseY + y, z, type);
                    }
                }
                if (scene != 1 && edge > 4) put(x, baseY + wallTop, z, scene == 4 ? Blocks.CALCITE : Blocks.DEEPSLATE);
            }
            if (localZ % (scene == 3 ? 5 : 7) == 0) {
                put(-6, baseY + 5, z, Blocks.GLOWSTONE);
                put(6, baseY + 3, z, Blocks.GLOWSTONE);
            }
        }
        int treeStep = scene == 3 ? 6 : scene == 1 ? 12 : 8;
        for (int localZ = 4; localZ < STAGE_LENGTH; localZ += treeStep) {
            tree(-5, baseY, oz + localZ);
            tree(5, baseY, oz + localZ + 2);
        }
        entryArch(oz + 1, Blocks.MOSSY_STONE_BRICKS, Blocks.GLOWSTONE);
        if (scene == 2) routeArch(stage, 26, Blocks.DEEPSLATE_BRICKS, Blocks.GLOWSTONE);
        if (scene == 4) routeArch(stage, 34, Blocks.CALCITE, Blocks.SEA_LANTERN);
        addPath(lushSectionName(stage), stage, lushPath(stage));
    }

    private Block lushPath(int stage) {
        return switch (Math.floorMod(sceneIndex(stage), 5)) {
            case 1 -> Blocks.MOSS_BLOCK;
            case 2 -> Blocks.MOSSY_STONE_BRICKS;
            case 3 -> Blocks.OAK_PLANKS;
            case 4 -> Blocks.CALCITE;
            default -> Blocks.STONE_BRICKS;
        };
    }

    private String lushSectionName(int stage) {
        String section = switch (Math.floorMod(sceneIndex(stage), 5)) {
            case 1 -> "露天苔藓谷";
            case 2 -> "深岩瀑布洞";
            case 3 -> "垂藤林间道";
            case 4 -> "方解石水晶窟";
            default -> "繁花洞穴入口";
        };
        return "繁茂洞穴 · " + section;
    }

    private void checkerGarden(int stage) {
        int oz = stageZ(stage);
        int scene = Math.floorMod(sceneIndex(stage), 4);
        int wallX = switch (scene) {
            case 1 -> 9;
            case 2 -> 7;
            default -> 8;
        };
        int wallHeight = switch (scene) {
            case 0 -> 6;
            case 1 -> 4;
            case 2 -> 8;
            default -> 7;
        };
        for (int localZ = 0; localZ <= STAGE_LENGTH; localZ++) {
            int z = oz + localZ;
            for (int x = -10; x <= 10; x++) {
                put(x, baseY - 1, z, Math.abs(x) < 4 ? Blocks.GRASS_BLOCK : Blocks.DIRT);
            }
            boolean openBand = scene == 1 && localZ % 16 >= 5 && localZ % 16 <= 11;
            boolean openLeft = scene == 2 && ((localZ / 8) & 1) == 0;
            boolean openRight = scene == 2 && !openLeft;
            for (int y = 0; y <= wallHeight; y++) {
                Block left = ((localZ + y) & 1) == 0 ? Blocks.CONCRETE.red() : Blocks.CONCRETE.white();
                Block right = left == Blocks.CONCRETE.red() ? Blocks.CONCRETE.white() : Blocks.CONCRETE.red();
                if (!openBand && !openLeft) {
                    put(-wallX, baseY + y, z, left);
                    put(-wallX - 1, baseY + y, z, right);
                }
                if (!openBand && !openRight) {
                    put(wallX, baseY + y, z, right);
                    put(wallX + 1, baseY + y, z, left);
                }
            }
        }
        for (int localZ = 6 + scene; localZ < STAGE_LENGTH; localZ += scene == 1 ? 14 : 10) {
            lamp(-5, baseY, oz + localZ);
            lamp(5, baseY, oz + localZ + 3);
        }
        entryArch(oz + 1, Blocks.CONCRETE.red(), Blocks.SEA_LANTERN);
        if (scene == 2 || scene == 3) {
            entryArch(oz + 17, Blocks.CONCRETE.white(), Blocks.GLOWSTONE);
            entryArch(oz + 35, Blocks.CONCRETE.red(), Blocks.SEA_LANTERN);
        }
        addPath(checkerSectionName(stage), stage, checkerPath(stage));
    }

    private Block checkerPath(int stage) {
        return switch (Math.floorMod(sceneIndex(stage), 4)) {
            case 1 -> Blocks.SMOOTH_SANDSTONE;
            case 2 -> Blocks.CONCRETE.white();
            case 3 -> Blocks.STONE_BRICKS;
            default -> Blocks.QUARTZ_BLOCK;
        };
    }

    private String checkerSectionName(int stage) {
        String section = switch (Math.floorMod(sceneIndex(stage), 4)) {
            case 1 -> "开放看台";
            case 2 -> "交错回廊";
            case 3 -> "竞速拱门";
            default -> "棋盘峡谷";
        };
        return "红白花园 · " + section;
    }

    private void honeyMine(int stage) {
        int oz = stageZ(stage);
        int scene = Math.floorMod(sceneIndex(stage), 5);
        int wallStart = scene == 1 ? 7 : 6;
        int wallTop = scene == 2 ? 11 : scene == 3 ? 7 : 9;
        for (int localZ = 0; localZ <= STAGE_LENGTH; localZ++) {
            int z = oz + localZ;
            for (int x = -9; x <= 9; x++) {
                put(x, baseY - 3, z, Blocks.DEEPSLATE);
                if (Math.abs(x) >= wallStart) {
                    for (int y = -2; y <= wallTop; y++) {
                        boolean window = (scene == 1 || scene == 4)
                            && localZ % 16 >= 4 && localZ % 16 <= 10 && y >= 2 && y <= 6;
                        Block type = window
                            ? Blocks.GLASS
                            : (x * x + y + localZ + scene) % (scene == 2 ? 4 : 6) == 0
                                ? Blocks.HONEYCOMB_BLOCK
                                : Blocks.COBBLED_DEEPSLATE;
                        put(x, baseY + y, z, type);
                    }
                }
                if (scene != 1 && Math.abs(x) > 3) put(x, baseY + wallTop, z, Blocks.COBBLED_DEEPSLATE);
            }
            if (localZ % 6 == 0) {
                put(-5, baseY + 4, z, Blocks.GLOWSTONE);
                put(5, baseY + 6, z, Blocks.GLOWSTONE);
            }
        }
        int archStep = scene == 3 ? 8 : scene == 1 ? 16 : 10;
        for (int localZ = 5; localZ < STAGE_LENGTH; localZ += archStep) {
            entryArch(oz + localZ, Blocks.SPRUCE_PLANKS, Blocks.GLOWSTONE);
        }
        addPath(honeySectionName(stage), stage, honeyPath(stage));
    }

    private Block honeyPath(int stage) {
        return switch (Math.floorMod(sceneIndex(stage), 5)) {
            case 1 -> Blocks.OAK_PLANKS;
            case 2 -> Blocks.HONEYCOMB_BLOCK;
            case 3 -> Blocks.DARK_OAK_PLANKS;
            default -> Blocks.SPRUCE_PLANKS;
        };
    }

    private String honeySectionName(int stage) {
        String section = switch (Math.floorMod(sceneIndex(stage), 5)) {
            case 1 -> "露天运输桥";
            case 2 -> "蜂蜡熔炉";
            case 3 -> "木梁升降井";
            case 4 -> "玻璃蜂房";
            default -> "深板岩矿廊";
        };
        return "蜂巢矿洞 · " + section;
    }

    private void sunsetTower(int stage) {
        int oz = stageZ(stage);
        int scene = Math.floorMod(sceneIndex(stage), 5);
        int wallStart = scene == 1 ? 9 : scene == 3 ? 7 : 6;
        for (int localZ = 0; localZ <= STAGE_LENGTH; localZ++) {
            int z = oz + localZ;
            for (int x = -10; x <= 10; x++) {
                boolean terraceGap = scene == 1 && localZ % 18 >= 4 && localZ % 18 <= 13;
                if (!terraceGap && Math.abs(x) >= wallStart) {
                    int height = (scene == 2 ? 9 : 5) + Math.floorMod(x + localZ + scene, 5);
                    for (int y = -3; y <= height; y++) {
                        Block type = (x + y + localZ + scene) % 7 == 0
                            ? Blocks.CHERRY_PLANKS
                            : scene == 3 ? Blocks.QUARTZ_BLOCK : Blocks.SMOOTH_SANDSTONE;
                        put(x, baseY + y, z, type);
                    }
                } else {
                    put(x, baseY - 2, z, Blocks.GRASS_BLOCK);
                }
            }
        }
        int treeStep = scene == 4 ? 6 : scene == 1 ? 12 : 8;
        for (int localZ = 4; localZ <= STAGE_LENGTH - 4; localZ += treeStep) {
            cherryTree(-5, baseY, oz + localZ);
            cherryTree(5, baseY, oz + localZ + 3);
        }
        entryArch(oz + 1, Blocks.CHERRY_PLANKS, Blocks.GLOWSTONE);
        if (scene == 2 || scene == 3) routeArch(stage, 25, Blocks.CHERRY_LOG, Blocks.SEA_LANTERN);
        addPath(cherrySectionName(stage), stage, cherryPath(stage));
    }

    private Block cherryPath(int stage) {
        return switch (Math.floorMod(sceneIndex(stage), 5)) {
            case 1 -> Blocks.CHERRY_PLANKS;
            case 2 -> Blocks.SMOOTH_SANDSTONE;
            case 3 -> Blocks.QUARTZ_BLOCK;
            case 4 -> Blocks.MOSS_BLOCK;
            default -> Blocks.CALCITE;
        };
    }

    private String cherrySectionName(int stage) {
        String section = switch (Math.floorMod(sceneIndex(stage), 5)) {
            case 1 -> "日落观景台";
            case 2 -> "樱木塔楼";
            case 3 -> "白石空中廊";
            case 4 -> "密樱花园";
            default -> "樱花高塔入口";
        };
        return "樱花高塔 · " + section;
    }

    private void icePalace(int stage) {
        int oz = stageZ(stage);
        int scene = Math.floorMod(sceneIndex(stage), 5);
        int wallX = scene == 1 ? 9 : scene == 3 ? 7 : 8;
        int wallTop = scene == 2 ? 10 : scene == 1 ? 6 : 8;
        for (int localZ = 0; localZ <= STAGE_LENGTH; localZ++) {
            int z = oz + localZ;
            for (int x = -9; x <= 9; x++) {
                put(x, baseY - 2, z, Blocks.SNOW_BLOCK);
                put(x, baseY - 1, z, Math.abs(x) < 4 ? Blocks.PACKED_ICE : Blocks.BLUE_ICE);
                boolean openCourt = scene == 1 && localZ % 18 >= 5 && localZ % 18 <= 12;
                if (!openCourt && Math.abs(x) >= wallX) {
                    for (int y = 0; y <= wallTop; y++) {
                        boolean window = (scene == 2 || scene == 4)
                            && localZ % 14 >= 4 && localZ % 14 <= 9 && y >= 2 && y <= wallTop - 2;
                        Block type = window ? Blocks.GLASS : (localZ + y + scene) % 6 == 0
                            ? Blocks.SEA_LANTERN
                            : Blocks.PACKED_ICE;
                        put(x, baseY + y, z, type);
                    }
                }
            }
            if (localZ % 8 == 0) {
                put(-5, baseY + 2, z, Blocks.SEA_LANTERN);
                put(5, baseY + 4, z, Blocks.SEA_LANTERN);
            }
        }
        int archStep = scene == 3 ? 8 : scene == 1 ? 18 : 12;
        for (int localZ = 7; localZ < STAGE_LENGTH; localZ += archStep) {
            entryArch(oz + localZ, Blocks.BLUE_ICE, Blocks.SEA_LANTERN);
        }
        addPath(iceSectionName(stage), stage, icePath(stage));
    }

    private Block icePath(int stage) {
        return switch (Math.floorMod(sceneIndex(stage), 5)) {
            case 1 -> Blocks.SNOW_BLOCK;
            case 2 -> Blocks.PACKED_ICE;
            case 3 -> Blocks.BLUE_ICE;
            default -> Blocks.QUARTZ_BLOCK;
        };
    }

    private String iceSectionName(int stage) {
        String section = switch (Math.floorMod(sceneIndex(stage), 5)) {
            case 1 -> "雪原露台";
            case 2 -> "玻璃冰廊";
            case 3 -> "蓝冰拱桥";
            case 4 -> "海晶灯大厅";
            default -> "白雪宫门";
        };
        return "冰晶宫殿 · " + section;
    }

    private void netherForge(int stage) {
        int oz = stageZ(stage);
        int scene = Math.floorMod(sceneIndex(stage), 5);
        int wallStart = scene == 1 ? 9 : scene == 3 ? 6 : 5;
        int wallTop = scene == 2 ? 12 : scene == 1 ? 7 : 8;
        for (int localZ = 0; localZ <= STAGE_LENGTH; localZ++) {
            int z = oz + localZ;
            for (int x = -10; x <= 10; x++) {
                if (Math.abs(x) <= 4) {
                    put(x, baseY - 4, z, Blocks.MAGMA_BLOCK);
                    put(x, baseY - 3, z, Math.abs(x) <= 3 ? Blocks.LAVA : Blocks.BLACKSTONE);
                    for (int y = -2; y <= -1; y++) put(x, baseY + y, z, Blocks.AIR);
                }
                boolean openForge = scene == 1 && localZ % 18 >= 5 && localZ % 18 <= 12;
                if (!openForge && Math.abs(x) >= wallStart) {
                    for (int y = -3; y <= wallTop; y++) {
                        Block body = scene == 3 ? Blocks.RED_NETHER_BRICKS : scene == 4 ? Blocks.BASALT : Blocks.BLACKSTONE;
                        put(x, baseY + y, z, (x + y + localZ + scene) % 8 == 0 ? Blocks.NETHER_BRICKS : body);
                    }
                }
            }
            if (localZ % (scene == 2 ? 5 : 7) == 0) {
                put(-6, baseY + 4, z, Blocks.SHROOMLIGHT);
                put(6, baseY + 6, z, Blocks.SHROOMLIGHT);
            }
        }
        int archStep = scene == 3 ? 7 : scene == 1 ? 15 : 9;
        for (int localZ = 4; localZ < STAGE_LENGTH; localZ += archStep) {
            entryArch(oz + localZ, Blocks.NETHER_BRICKS, Blocks.SHROOMLIGHT);
        }
        addPath(netherSectionName(stage), stage, netherPath(stage));
    }

    private Block netherPath(int stage) {
        return switch (Math.floorMod(sceneIndex(stage), 5)) {
            case 1 -> Blocks.POLISHED_BLACKSTONE;
            case 2 -> Blocks.NETHER_BRICKS;
            case 3 -> Blocks.RED_NETHER_BRICKS;
            case 4 -> Blocks.SMOOTH_BASALT;
            default -> Blocks.BLACKSTONE;
        };
    }

    private String netherSectionName(int stage) {
        String section = switch (Math.floorMod(sceneIndex(stage), 5)) {
            case 1 -> "露天锻造台";
            case 2 -> "炽热机械厅";
            case 3 -> "赤红拱门阵";
            case 4 -> "玄武岩烟道";
            default -> "下界熔炉入口";
        };
        return "下界熔炉 · " + section;
    }

    private void crystalGarden(int stage) {
        int oz = stageZ(stage);
        int scene = Math.floorMod(sceneIndex(stage), 5);
        int wallX = scene == 1 ? 10 : scene == 3 ? 7 : 8;
        int wallTop = scene == 2 ? 12 : scene == 1 ? 6 : 9;
        for (int localZ = 0; localZ <= STAGE_LENGTH; localZ++) {
            int z = oz + localZ;
            for (int x = -10; x <= 10; x++) {
                put(x, baseY - 2, z, Blocks.CALCITE);
                put(x, baseY - 1, z, Math.abs(x) < 5 ? Blocks.MOSS_BLOCK : Blocks.AMETHYST_BLOCK);
                boolean openCourt = scene == 1 && localZ % 18 >= 4 && localZ % 18 <= 13;
                if (!openCourt && Math.abs(x) >= wallX) {
                    for (int y = 0; y <= wallTop; y++) {
                        boolean window = scene == 4 && localZ % 14 >= 4 && localZ % 14 <= 9 && y >= 2 && y <= 6;
                        Block type = window ? Blocks.GLASS
                            : (x + y + localZ + scene) % 5 == 0 ? Blocks.AMETHYST_BLOCK : Blocks.CALCITE;
                        put(x, baseY + y, z, type);
                    }
                }
            }
        }
        int pillarStep = scene == 2 ? 6 : scene == 1 ? 12 : 8;
        for (int localZ = 4; localZ < STAGE_LENGTH; localZ += pillarStep) {
            crystalPillar(-5, baseY, oz + localZ, 3 + Math.floorMod(localZ + scene, 4));
            crystalPillar(5, baseY, oz + localZ + 3, 4 + Math.floorMod(localZ + scene, 3));
        }
        entryArch(oz + 1, Blocks.AMETHYST_BLOCK, Blocks.SEA_LANTERN);
        if (scene == 3) entryArch(oz + 25, Blocks.CALCITE, Blocks.SEA_LANTERN);
        addPath(crystalSectionName(stage), stage, crystalPath(stage));
    }

    private Block crystalPath(int stage) {
        return switch (Math.floorMod(sceneIndex(stage), 5)) {
            case 1 -> Blocks.CALCITE;
            case 2 -> Blocks.AMETHYST_BLOCK;
            case 4 -> Blocks.QUARTZ_BLOCK;
            default -> Blocks.PURPUR_BLOCK;
        };
    }

    private String crystalSectionName(int stage) {
        String section = switch (Math.floorMod(sceneIndex(stage), 5)) {
            case 1 -> "开阔水晶庭院";
            case 2 -> "紫晶尖塔林";
            case 3 -> "方解石拱桥";
            case 4 -> "玻璃观景廊";
            default -> "紫晶花园门厅";
        };
        return "紫晶花园 · " + section;
    }

    private void themedGallery(int stage, String theme, int scene) {
        int oz = stageZ(stage);
        ThemePalette palette = extendedPalette(theme);
        int wallTop = switch (scene) {
            case 1 -> 7;
            case 2 -> 12;
            case 4 -> 10;
            default -> 8;
        };
        for (int localZ = 0; localZ <= STAGE_LENGTH; localZ++) {
            int z = oz + localZ;
            boolean windowBand = scene == 2 && localZ % 14 >= 4 && localZ % 14 <= 9;
            boolean openCourt = scene == 3 && localZ % 18 >= 3 && localZ % 18 <= 14;
            for (int x = -11; x <= 11; x++) {
                put(x, baseY - 2, z, palette.ground());
                Block floor = Math.abs(x) <= 5
                    ? ((localZ / 6 + scene) & 1) == 0 ? palette.path() : palette.panel()
                    : palette.ground();
                put(x, baseY - 1, z, floor);
                if (!openCourt && Math.abs(x) >= 9) {
                    for (int y = 0; y <= wallTop; y++) {
                        Block wall = windowBand && y >= 2 && y <= wallTop - 2
                            ? Blocks.GLASS
                            : y == 0 || y == wallTop || localZ % 8 == 0
                                ? palette.frame()
                                : (x + y + localZ + scene) % 7 == 0 ? palette.accent() : palette.panel();
                        put(x, baseY + y, z, wall);
                    }
                }
            }
            if ((scene == 1 || scene == 4) && localZ % 12 == 6) {
                for (int x = -8; x <= 8; x++) put(x, baseY + wallTop + 1, z, palette.frame());
                put(courseX(z), baseY + wallTop, z, palette.light());
                put(courseX(z) + 1, baseY + wallTop, z, palette.light());
            }
        }
        entryArch(oz + 1, palette.frame(), palette.light());
        if (scene == 4) routeArch(stage, 25, palette.accent(), palette.light());
        addPath(palette.name() + " · " + subsceneName(theme, scene), stage, palette.path());
    }

    private ThemePalette extendedPalette(String theme) {
        ThemePalette palette = switch (theme) {
            case "village" -> new ThemePalette(Blocks.DIRT, Blocks.MOSS_BLOCK, Blocks.OAK_LOG, Blocks.OAK_PLANKS, Blocks.COBBLESTONE, Blocks.GLOWSTONE, "村庄花园");
            case "library" -> new ThemePalette(Blocks.STONE_BRICKS, Blocks.OAK_PLANKS, Blocks.DARK_OAK_LOG, Blocks.BOOKSHELF, Blocks.QUARTZ_BLOCK, Blocks.SEA_LANTERN, "高层图书馆");
            case "lava" -> new ThemePalette(Blocks.MAGMA_BLOCK, Blocks.SMOOTH_SANDSTONE, Blocks.POLISHED_BLACKSTONE_BRICKS, Blocks.RED_SANDSTONE, Blocks.GOLD_BLOCK, Blocks.SHROOMLIGHT, "熔岩峡谷");
            case "lush" -> new ThemePalette(Blocks.DEEPSLATE, Blocks.MOSS_BLOCK, Blocks.MOSSY_STONE_BRICKS, Blocks.CALCITE, Blocks.OAK_LEAVES, Blocks.GLOWSTONE, "繁茂洞穴");
            case "checker" -> new ThemePalette(Blocks.DIRT, Blocks.QUARTZ_BLOCK, Blocks.CONCRETE.red(), Blocks.CONCRETE.white(), Blocks.GOLD_BLOCK, Blocks.SEA_LANTERN, "红白花园");
            case "honey" -> new ThemePalette(Blocks.DEEPSLATE, Blocks.OAK_PLANKS, Blocks.HONEYCOMB_BLOCK, Blocks.SPRUCE_PLANKS, Blocks.GOLD_BLOCK, Blocks.SHROOMLIGHT, "蜂巢矿洞");
            case "cherry" -> new ThemePalette(Blocks.GRASS_BLOCK, Blocks.CHERRY_PLANKS, Blocks.CHERRY_LOG, Blocks.QUARTZ_BLOCK, Blocks.CHERRY_LEAVES, Blocks.GLOWSTONE, "樱花高塔");
            case "ice" -> new ThemePalette(Blocks.SNOW_BLOCK, Blocks.PACKED_ICE, Blocks.BLUE_ICE, Blocks.QUARTZ_BLOCK, Blocks.GLASS, Blocks.SEA_LANTERN, "冰晶宫殿");
            case "nether" -> new ThemePalette(Blocks.MAGMA_BLOCK, Blocks.POLISHED_BLACKSTONE, Blocks.NETHER_BRICKS, Blocks.RED_NETHER_BRICKS, Blocks.GOLD_BLOCK, Blocks.SHROOMLIGHT, "下界熔炉");
            case "crystal" -> new ThemePalette(Blocks.CALCITE, Blocks.PURPUR_BLOCK, Blocks.AMETHYST_BLOCK, Blocks.QUARTZ_BLOCK, Blocks.MOSS_BLOCK, Blocks.SEA_LANTERN, "紫晶花园");
            case "desert" -> new ThemePalette(Blocks.SANDSTONE, Blocks.SMOOTH_SANDSTONE, Blocks.CHISELED_SANDSTONE, Blocks.CUT_SANDSTONE, Blocks.GOLD_BLOCK, Blocks.SEA_LANTERN, "沙漠神殿");
            case "bamboo" -> new ThemePalette(Blocks.MOSS_BLOCK, Blocks.BAMBOO_PLANKS, Blocks.BAMBOO_BLOCK, Blocks.OAK_PLANKS, Blocks.OAK_LEAVES, Blocks.GLOWSTONE, "竹林寺院");
            case "ocean" -> new ThemePalette(Blocks.PRISMARINE, Blocks.PRISMARINE_BRICKS, Blocks.DARK_PRISMARINE, Blocks.GLASS, Blocks.QUARTZ_BLOCK, Blocks.SEA_LANTERN, "海晶神殿");
            case "mushroom" -> new ThemePalette(Blocks.MYCELIUM, Blocks.MUSHROOM_STEM, Blocks.RED_MUSHROOM_BLOCK, Blocks.BROWN_MUSHROOM_BLOCK, Blocks.SHROOMLIGHT, Blocks.GLOWSTONE, "蘑菇乐园");
            case "copper" -> new ThemePalette(Blocks.STONE_BRICKS, Blocks.IRON_BLOCK, Blocks.COPPER_ORE, Blocks.POLISHED_DEEPSLATE, Blocks.GOLD_BLOCK, Blocks.GLOWSTONE, "铜艺工厂");
            case "redstone" -> new ThemePalette(Blocks.STONE, Blocks.IRON_BLOCK, Blocks.REDSTONE_BLOCK, Blocks.POLISHED_DEEPSLATE, Blocks.GOLD_BLOCK, Blocks.SEA_LANTERN, "红石机械城");
            case "quartz" -> new ThemePalette(Blocks.QUARTZ_BLOCK, Blocks.SMOOTH_QUARTZ, Blocks.QUARTZ_PILLAR, Blocks.GLASS, Blocks.GOLD_BLOCK, Blocks.SEA_LANTERN, "白石圣殿");
            case "castle" -> new ThemePalette(Blocks.COBBLESTONE, Blocks.STONE_BRICKS, Blocks.MOSSY_STONE_BRICKS, Blocks.CRACKED_STONE_BRICKS, Blocks.IRON_BLOCK, Blocks.GLOWSTONE, "石砖王城");
            case "melon" -> new ThemePalette(Blocks.DIRT, Blocks.OAK_PLANKS, Blocks.HAY_BLOCK, Blocks.GRASS_BLOCK, Blocks.MELON, Blocks.GLOWSTONE, "西瓜农庄");
            case "coral" -> new ThemePalette(Blocks.SANDSTONE, Blocks.PRISMARINE, Blocks.SMOOTH_SANDSTONE, Blocks.AMETHYST_BLOCK, Blocks.GOLD_BLOCK, Blocks.SEA_LANTERN, "珊瑚水庭");
            case "rainbow" -> new ThemePalette(Blocks.QUARTZ_BLOCK, Blocks.PURPUR_BLOCK, Blocks.AMETHYST_BLOCK, Blocks.GOLD_BLOCK, Blocks.EMERALD_BLOCK, Blocks.SEA_LANTERN, "彩虹玻璃城");
            case "swamp" -> new ThemePalette(Blocks.MUD, Blocks.MANGROVE_PLANKS, Blocks.MANGROVE_LOG, Blocks.MUD_BRICKS, Blocks.MOSS_BLOCK, Blocks.SHROOMLIGHT, "红树林水寨");
            case "birch" -> new ThemePalette(Blocks.DIRT, Blocks.BIRCH_PLANKS, Blocks.BIRCH_LOG, Blocks.QUARTZ_BLOCK, Blocks.OAK_LEAVES, Blocks.SEA_LANTERN, "白桦林庄园");
            case "azalea" -> new ThemePalette(Blocks.MOSS_BLOCK, Blocks.MOSSY_STONE_BRICKS, Blocks.CHERRY_LOG, Blocks.CHERRY_LEAVES, Blocks.AMETHYST_BLOCK, Blocks.GLOWSTONE, "杜鹃花庭院");
            case "obsidian" -> new ThemePalette(Blocks.BLACKSTONE, Blocks.OBSIDIAN, Blocks.CRYING_OBSIDIAN, Blocks.PURPUR_BLOCK, Blocks.AMETHYST_BLOCK, Blocks.SEA_LANTERN, "黑曜石要塞");
            case "gold" -> new ThemePalette(Blocks.SMOOTH_SANDSTONE, Blocks.GOLD_BLOCK, Blocks.QUARTZ_PILLAR, Blocks.CHISELED_SANDSTONE, Blocks.GLOWSTONE, Blocks.SEA_LANTERN, "黄金宫殿");
            case "emerald" -> new ThemePalette(Blocks.STONE_BRICKS, Blocks.EMERALD_BLOCK, Blocks.QUARTZ_BLOCK, Blocks.MOSS_BLOCK, Blocks.GOLD_BLOCK, Blocks.SEA_LANTERN, "翡翠神殿");
            case "factory" -> new ThemePalette(Blocks.STONE, Blocks.IRON_BLOCK, Blocks.COPPER_ORE, Blocks.POLISHED_DEEPSLATE, Blocks.REDSTONE_BLOCK, Blocks.GLOWSTONE, "蒸汽工厂");
            case "arcade" -> new ThemePalette(Blocks.QUARTZ_BLOCK, Blocks.AMETHYST_BLOCK, Blocks.PURPUR_BLOCK, Blocks.REDSTONE_BLOCK, Blocks.GOLD_BLOCK, Blocks.SEA_LANTERN, "霓虹游戏厅");
            case "savanna" -> new ThemePalette(Blocks.DIRT, Blocks.ACACIA_PLANKS, Blocks.ACACIA_LOG, Blocks.BRICKS, Blocks.GOLD_BLOCK, Blocks.GLOWSTONE, "热带草原城");
            case "alpine" -> new ThemePalette(Blocks.SNOW_BLOCK, Blocks.SPRUCE_PLANKS, Blocks.SPRUCE_LOG, Blocks.STONE_BRICKS, Blocks.BLUE_ICE, Blocks.SEA_LANTERN, "高山木屋");
            case "jungle" -> new ThemePalette(Blocks.MOSS_BLOCK, Blocks.MOSSY_STONE_BRICKS, Blocks.JUNGLE_LOG, Blocks.JUNGLE_PLANKS, Blocks.GOLD_BLOCK, Blocks.GLOWSTONE, "丛林神庙");
            case "coast" -> new ThemePalette(Blocks.STONE_BRICKS, Blocks.PRISMARINE_BRICKS, Blocks.COBBLESTONE, Blocks.QUARTZ_BLOCK, Blocks.DARK_PRISMARINE, Blocks.SEA_LANTERN, "海岸堡垒");
            case "oasis" -> new ThemePalette(Blocks.SANDSTONE, Blocks.SMOOTH_SANDSTONE, Blocks.CHISELED_SANDSTONE, Blocks.OAK_LEAVES, Blocks.GOLD_BLOCK, Blocks.SEA_LANTERN, "绿洲城邦");
            case "candy" -> new ThemePalette(Blocks.QUARTZ_BLOCK, Blocks.CONCRETE.white(), Blocks.CONCRETE.red(), Blocks.PURPUR_BLOCK, Blocks.AMETHYST_BLOCK, Blocks.SEA_LANTERN, "糖果工坊");
            case "clockwork" -> new ThemePalette(Blocks.STONE_BRICKS, Blocks.IRON_BLOCK, Blocks.COPPER_ORE, Blocks.GOLD_BLOCK, Blocks.REDSTONE_BLOCK, Blocks.GLOWSTONE, "钟表机械城");
            case "marble" -> new ThemePalette(Blocks.CALCITE, Blocks.SMOOTH_QUARTZ, Blocks.QUARTZ_PILLAR, Blocks.QUARTZ_BLOCK, Blocks.GOLD_BLOCK, Blocks.SEA_LANTERN, "大理石浴场");
            case "vineyard" -> new ThemePalette(Blocks.DIRT, Blocks.OAK_PLANKS, Blocks.DARK_OAK_LOG, Blocks.MOSS_BLOCK, Blocks.AMETHYST_BLOCK, Blocks.GLOWSTONE, "葡萄庄园");
            case "pumpkin" -> new ThemePalette(Blocks.DIRT, Blocks.HAY_BLOCK, Blocks.OAK_LOG, Blocks.OAK_PLANKS, Blocks.PUMPKIN, Blocks.GLOWSTONE, "南瓜嘉年华");
            case "aquarium" -> new ThemePalette(Blocks.PRISMARINE, Blocks.GLASS, Blocks.DARK_PRISMARINE, Blocks.PRISMARINE_BRICKS, Blocks.AMETHYST_BLOCK, Blocks.SEA_LANTERN, "水族长廊");
            case "railway" -> new ThemePalette(Blocks.STONE, Blocks.IRON_BLOCK, Blocks.DARK_OAK_PLANKS, Blocks.COPPER_ORE, Blocks.REDSTONE_BLOCK, Blocks.GLOWSTONE, "蒸汽铁路");
            case "harbor" -> new ThemePalette(Blocks.COBBLESTONE, Blocks.SPRUCE_PLANKS, Blocks.SPRUCE_LOG, Blocks.PRISMARINE, Blocks.IRON_BLOCK, Blocks.SEA_LANTERN, "海港船坞");
            case "cathedral" -> new ThemePalette(Blocks.STONE_BRICKS, Blocks.QUARTZ_BLOCK, Blocks.QUARTZ_PILLAR, Blocks.GLASS, Blocks.AMETHYST_BLOCK, Blocks.SEA_LANTERN, "彩窗教堂");
            case "dojo" -> new ThemePalette(Blocks.DIRT, Blocks.BAMBOO_PLANKS, Blocks.DARK_OAK_LOG, Blocks.CHERRY_PLANKS, Blocks.REDSTONE_BLOCK, Blocks.GLOWSTONE, "武道庭院");
            case "oriental" -> new ThemePalette(Blocks.STONE_BRICKS, Blocks.CHERRY_PLANKS, Blocks.RED_NETHER_BRICKS, Blocks.QUARTZ_BLOCK, Blocks.GOLD_BLOCK, Blocks.SEA_LANTERN, "东方宫殿");
            case "mesa" -> new ThemePalette(Blocks.RED_SANDSTONE, Blocks.CUT_RED_SANDSTONE, Blocks.CHISELED_RED_SANDSTONE, Blocks.SMOOTH_SANDSTONE, Blocks.GOLD_BLOCK, Blocks.GLOWSTONE, "彩陶峡谷");
            case "quarry" -> new ThemePalette(Blocks.STONE, Blocks.COBBLESTONE, Blocks.DEEPSLATE, Blocks.POLISHED_DEEPSLATE, Blocks.COPPER_ORE, Blocks.SEA_LANTERN, "石料矿场");
            case "greenhouse" -> new ThemePalette(Blocks.DIRT, Blocks.MOSS_BLOCK, Blocks.QUARTZ_BLOCK, Blocks.GLASS, Blocks.CHERRY_LEAVES, Blocks.SEA_LANTERN, "玻璃温室");
            case "carnival" -> new ThemePalette(Blocks.QUARTZ_BLOCK, Blocks.PURPUR_BLOCK, Blocks.CONCRETE.red(), Blocks.GOLD_BLOCK, Blocks.EMERALD_BLOCK, Blocks.SEA_LANTERN, "嘉年华乐园");
            case "laboratory" -> new ThemePalette(Blocks.QUARTZ_BLOCK, Blocks.IRON_BLOCK, Blocks.GLASS, Blocks.POLISHED_DEEPSLATE, Blocks.AMETHYST_BLOCK, Blocks.SEA_LANTERN, "晶能实验室");
            case "music" -> new ThemePalette(Blocks.DARK_OAK_PLANKS, Blocks.QUARTZ_BLOCK, Blocks.DARK_OAK_LOG, Blocks.NOTE_BLOCK, Blocks.GOLD_BLOCK, Blocks.SEA_LANTERN, "音乐殿堂");
            case "bakery" -> new ThemePalette(Blocks.BRICKS, Blocks.OAK_PLANKS, Blocks.SMOOTH_SANDSTONE, Blocks.HAY_BLOCK, Blocks.GOLD_BLOCK, Blocks.GLOWSTONE, "烘焙工坊");
            case "volcano" -> new ThemePalette(Blocks.MAGMA_BLOCK, Blocks.BLACKSTONE, Blocks.RED_NETHER_BRICKS, Blocks.BASALT, Blocks.GOLD_BLOCK, Blocks.SHROOMLIGHT, "火山神殿");
            case "lagoon" -> new ThemePalette(Blocks.SANDSTONE, Blocks.PRISMARINE, Blocks.SMOOTH_SANDSTONE, Blocks.MOSS_BLOCK, Blocks.AMETHYST_BLOCK, Blocks.SEA_LANTERN, "热带泻湖");
            case "autumn" -> new ThemePalette(Blocks.DIRT, Blocks.OAK_PLANKS, Blocks.BRICKS, Blocks.HAY_BLOCK, Blocks.RED_MUSHROOM_BLOCK, Blocks.GLOWSTONE, "秋叶庄园");
            case "winter" -> new ThemePalette(Blocks.SNOW_BLOCK, Blocks.SPRUCE_PLANKS, Blocks.PACKED_ICE, Blocks.QUARTZ_BLOCK, Blocks.BLUE_ICE, Blocks.SEA_LANTERN, "冬日村镇");
            case "dragon" -> new ThemePalette(Blocks.DEEPSLATE, Blocks.RED_NETHER_BRICKS, Blocks.OBSIDIAN, Blocks.POLISHED_BLACKSTONE_BRICKS, Blocks.GOLD_BLOCK, Blocks.SHROOMLIGHT, "龙纹圣殿");
            case "maze" -> new ThemePalette(Blocks.DIRT, Blocks.MOSS_BLOCK, Blocks.MOSSY_STONE_BRICKS, Blocks.OAK_LEAVES, Blocks.QUARTZ_BLOCK, Blocks.SEA_LANTERN, "花园迷宫");
            case "observatory" -> new ThemePalette(Blocks.QUARTZ_BLOCK, Blocks.POLISHED_DEEPSLATE, Blocks.GLASS, Blocks.AMETHYST_BLOCK, Blocks.GOLD_BLOCK, Blocks.SEA_LANTERN, "星象大厅");
            case "stadium" -> new ThemePalette(Blocks.STONE_BRICKS, Blocks.QUARTZ_BLOCK, Blocks.CONCRETE.red(), Blocks.IRON_BLOCK, Blocks.GOLD_BLOCK, Blocks.SEA_LANTERN, "竞技场");
            default -> new ThemePalette(Blocks.DIRT, Blocks.MOSS_BLOCK, Blocks.OAK_LOG, Blocks.OAK_PLANKS, Blocks.COBBLESTONE, Blocks.GLOWSTONE, "村庄花园");
        };
        return applyPaletteVariant(palette);
    }

    private ThemePalette applyPaletteVariant(ThemePalette palette) {
        return switch (paletteVariant) {
            case 1 -> new ThemePalette(palette.ground(), palette.panel(), palette.frame(), palette.path(), palette.accent(), palette.light(), palette.name());
            case 2 -> new ThemePalette(palette.ground(), palette.accent(), palette.panel(), palette.frame(), palette.path(), palette.light(), palette.name());
            case 3 -> new ThemePalette(palette.ground(), palette.path(), palette.accent(), palette.panel(), palette.frame(), palette.light(), palette.name());
            default -> palette;
        };
    }

    private void decorateThemeSubscene(int stage, String theme, int subscene) {
        ThemePalette palette = extendedPalette(theme);
        int oz = stageZ(stage);
        int themeIndex = Math.max(0, BASE_THEMES.indexOf(theme));
        int heightBias = themeIndex % 3 + landmarkPack % 2;
        int positionShift = landmarkPack % 3 - 1;
        boolean mirrored = ((themeIndex + landmarkPack) & 1) == 1;
        switch (subscene) {
            case 0 -> {
                routeArch(stage, 7 + positionShift, palette.frame(), palette.light());
                routeArch(stage, 24, palette.accent(), palette.light());
                routeArch(stage, 41 - positionShift, palette.frame(), palette.light());
                themePillar(mirrored ? 7 : -7, baseY, oz + 15, 5 + heightBias, palette);
                themePillar(mirrored ? -7 : 7, baseY, oz + 33, 6 + heightBias, palette);
            }
            case 1 -> {
                int[] pillarPositions = landmarkPack < 3
                    ? new int[] {6, 15, 24, 33, 42}
                    : new int[] {8, 18, 30, 40};
                for (int localZ : pillarPositions) {
                    int leftHeight = 4 + heightBias + Math.floorMod(localZ / 9, 3);
                    int rightHeight = 6 + heightBias + Math.floorMod(localZ / 9 + 1, 3);
                    themePillar(-7, baseY, oz + localZ, mirrored ? rightHeight : leftHeight, palette);
                    themePillar(7, baseY, oz + localZ, mirrored ? leftHeight : rightHeight, palette);
                }
            }
            case 2 -> {
                themeWindowFrame(stage, 10 + positionShift, 8 + heightBias, palette);
                themeWindowFrame(stage, 24, 10 + heightBias + landmarkPack / 3, palette);
                themeWindowFrame(stage, 38 - positionShift, 8 + heightBias, palette);
            }
            case 3 -> {
                for (int localZ : new int[] {8, 18, 30, 40}) {
                    int side = ((localZ / 8 + themeIndex + landmarkPack) & 1) == 0 ? -7 : 7;
                    themeMonument(side, baseY, oz + localZ, palette);
                }
                themePillar(-7, baseY, oz + 24, 7 + heightBias, palette);
                themePillar(7, baseY, oz + 24, 7 + heightBias, palette);
            }
            case 4 -> {
                themeBridgeRail(oz, -7, palette, mirrored);
                themeBridgeRail(oz, 7, palette, !mirrored);
                routeArch(stage, 8 + positionShift, palette.frame(), palette.light());
                routeArch(stage, 40 - positionShift, palette.accent(), palette.light());
            }
            case 5 -> {
                themeTower(-7, baseY, oz + 14 + positionShift, 8 + heightBias, palette);
                themeTower(7, baseY, oz + 14 + positionShift, 10 + heightBias + landmarkPack / 3, palette);
                themeTower(-7, baseY, oz + 35 - positionShift, 10 + heightBias + landmarkPack / 3, palette);
                themeTower(7, baseY, oz + 35 - positionShift, 8 + heightBias, palette);
                routeArch(stage, 24, palette.accent(), palette.light());
            }
            case 6 -> {
                int[] canopyPositions = landmarkPack % 2 == 0
                    ? new int[] {7, 18, 30, 41}
                    : new int[] {9, 24, 39};
                for (int localZ : canopyPositions) {
                    themeCanopy(stage, localZ, 9 + heightBias, palette);
                }
                themeMonument(mirrored ? 7 : -7, baseY, oz + 24, palette);
            }
            default -> {
                routeArch(stage, 5, palette.accent(), palette.light());
                routeArch(stage, 24, palette.frame(), palette.light());
                routeArch(stage, 43, palette.accent(), palette.light());
                themeTower(-7, baseY, oz + 24, 9 + heightBias, palette);
                themeTower(7, baseY, oz + 24, 9 + heightBias, palette);
                themeMonument(mirrored ? -6 : 6, baseY, oz + 13, palette);
                themeMonument(mirrored ? 6 : -6, baseY, oz + 36, palette);
            }
        }
    }

    private void themeWindowFrame(int stage, int localZ, int height, ThemePalette palette) {
        int z = stageZ(stage) + localZ;
        int center = courseX(z);
        int left = center - 6;
        int right = center + 7;
        for (int y = 0; y <= height; y++) {
            put(left, baseY + y, z, y >= 2 && y <= height - 2 ? Blocks.GLASS : palette.frame());
            put(right, baseY + y, z, y >= 2 && y <= height - 2 ? Blocks.GLASS : palette.frame());
        }
        put(left, baseY + height - 1, z, palette.light());
        put(right, baseY + height - 1, z, palette.light());
    }

    private void themeBridgeRail(int oz, int x, ThemePalette palette, boolean staggered) {
        for (int localZ = 2; localZ < STAGE_LENGTH; localZ += 2) {
            put(x, baseY, oz + localZ, palette.frame());
            if ((localZ / 2 + (staggered ? 1 : 0)) % 3 == 0) put(x, baseY + 1, oz + localZ, palette.light());
        }
    }

    private void themeTower(int x, int y, int z, int height, ThemePalette palette) {
        for (int dx = -1; dx <= 1; dx++) {
            for (int dz = -1; dz <= 1; dz++) {
                for (int h = 0; h < height; h++) {
                    boolean edge = Math.abs(dx) + Math.abs(dz) > 0;
                    put(x + dx, y + h, z + dz, edge ? palette.frame() : palette.panel());
                }
            }
        }
        put(x, y + height, z, palette.accent());
        put(x, y + height + 1, z, palette.light());
    }

    private void themeCanopy(int stage, int localZ, int height, ThemePalette palette) {
        int z = stageZ(stage) + localZ;
        int center = courseX(z);
        for (int x = center - 7; x <= center + 8; x++) {
            put(x, baseY + height, z, (x - center) % 4 == 0 ? palette.accent() : palette.frame());
        }
        put(center, baseY + height - 1, z, palette.light());
        put(center + 1, baseY + height - 1, z, palette.light());
    }

    private void themePillar(int x, int y, int z, int height, ThemePalette palette) {
        for (int h = 0; h < height; h++) put(x, y + h, z, h == height - 1 ? palette.light() : palette.frame());
        put(x, y + Math.max(1, height - 2), z, palette.accent());
    }

    private void themeMonument(int x, int y, int z, ThemePalette palette) {
        for (int dx = -1; dx <= 1; dx++) {
            for (int dz = -1; dz <= 1; dz++) put(x + dx, y, z + dz, palette.panel());
        }
        put(x, y + 1, z, palette.frame());
        put(x, y + 2, z, palette.accent());
        put(x, y + 3, z, palette.light());
    }

    private void renameLatestStage(String theme, int subscene) {
        if (stages.isEmpty()) return;
        int lastIndex = stages.size() - 1;
        Stage previous = stages.get(lastIndex);
        stages.set(lastIndex, new Stage(extendedPalette(theme).name() + " · " + subsceneName(theme, subscene), previous.waypoints()));
    }

    private String subsceneName(String theme, int subscene) {
        String[] names = switch (theme) {
            case "village" -> new String[] {"村口三拱门", "果园立柱道", "钟楼高窗街", "集市纪念广场", "河畔木桥", "双风车塔道", "藤架灯廊", "庆典终点厅"};
            case "library" -> new String[] {"迎宾书拱门", "卷轴立柱廊", "高窗阅览厅", "典籍雕像庭", "悬空书桥", "双塔藏书阁", "格栅灯廊", "穹顶总馆厅"};
            case "lava" -> new String[] {"炽岩入口阵", "岩浆立柱谷", "熔火高窗壁", "黑石祭坛庭", "熔河石桥", "双焰塔道", "玄武岩梁廊", "火山终点厅"};
            case "lush" -> new String[] {"苔藓石门", "垂藤立柱径", "方解石光窗", "孢子花庭", "地下溪桥", "双生树塔", "叶幕灯廊", "繁花出口厅"};
            case "checker" -> new String[] {"红白拱门阵", "棋格立柱道", "彩窗长厅", "旗帜广场", "双色栈桥", "双旗塔道", "格纹顶廊", "冠军终点厅"};
            case "honey" -> new String[] {"蜂巢入口门", "蜜柱运输廊", "蜂房光窗厅", "蜂王纪念庭", "蜜槽栈桥", "双巢塔道", "蜂蜡梁廊", "蜂蜜总装厅"};
            case "cherry" -> new String[] {"花瓣山门", "樱木立柱径", "粉晶高窗厅", "花见庭院", "樱河拱桥", "双樱塔道", "花棚灯廊", "樱冠终点厅"};
            case "ice" -> new String[] {"冰川入口门", "蓝冰立柱廊", "冰晶高窗厅", "雪花纪念庭", "冻湖透明桥", "双冰塔道", "霜梁灯廊", "极光终点厅"};
            case "nether" -> new String[] {"黑石入口阵", "赤红立柱道", "熔炉高窗厅", "镀金祭坛庭", "岩浆跨桥", "双炉塔道", "玄武岩顶廊", "下界核心厅"};
            case "crystal" -> new String[] {"紫晶入口门", "晶柱回廊", "方解石高窗厅", "晶簇花庭", "水晶拱桥", "双晶塔道", "晶格灯廊", "紫晶核心厅"};
            case "desert" -> new String[] {"神殿入口门", "砂岩列柱道", "日光高窗厅", "金像庭院", "绿洲石桥", "双塔神庙道", "遮阳梁廊", "法老终点厅"};
            case "bamboo" -> new String[] {"竹寺山门", "竹柱参道", "纸窗禅厅", "石灯庭院", "溪谷竹桥", "双阁塔道", "竹棚灯廊", "金顶大殿"};
            case "ocean" -> new String[] {"海晶入口门", "潮汐列柱道", "水幕高窗厅", "海灯祭坛庭", "珊瑚跨海桥", "双潮塔道", "海晶梁廊", "深海核心厅"};
            case "mushroom" -> new String[] {"菌伞入口门", "蘑菇立柱径", "孢子高窗厅", "菌环庭院", "菌丝木桥", "双菇塔道", "菌盖灯廊", "蘑菇庆典厅"};
            case "copper" -> new String[] {"铜厂铸造门", "铆钉立柱道", "齿轮高窗厅", "铜像装配庭", "管线栈桥", "双炉塔道", "铜梁灯廊", "中央动力厅"};
            case "redstone" -> new String[] {"机关入口门", "红石脉冲柱", "电路高窗厅", "活塞测试庭", "信号跨桥", "双控塔道", "线路顶廊", "主控核心厅"};
            case "quartz" -> new String[] {"圣殿白石门", "石英列柱道", "日光高窗厅", "金徽庭院", "云纹石桥", "双塔圣道", "白石梁廊", "圣光终点厅"};
            case "castle" -> new String[] {"王城吊桥门", "城墙立柱道", "箭窗大厅", "骑士雕像庭", "护城河石桥", "双堡塔道", "城梁灯廊", "王座终点厅"};
            case "melon" -> new String[] {"农庄木门", "瓜田立柱径", "谷仓高窗厅", "丰收庭院", "灌溉渠桥", "双仓塔道", "葡萄架灯廊", "丰收庆典厅"};
            case "coral" -> new String[] {"珊瑚水门", "礁石立柱道", "水晶高窗厅", "海葵庭院", "泻湖拱桥", "双礁塔道", "珊瑚梁廊", "海湾终点厅"};
            case "rainbow" -> new String[] {"彩虹入口门", "七彩立柱道", "棱镜高窗厅", "光谱广场", "彩带玻璃桥", "双虹塔道", "彩光顶廊", "幻彩终点厅"};
            case "swamp" -> new String[] {"水寨木门", "红树立柱径", "湿地高窗厅", "荷塘庭院", "沼泽木桥", "双寨塔道", "藤蔓棚廊", "红树主厅"};
            case "birch" -> new String[] {"白桦庄园门", "白木立柱径", "明亮高窗厅", "喷泉庭院", "林溪木桥", "双庄塔道", "白桦棚廊", "庄园宴会厅"};
            case "azalea" -> new String[] {"杜鹃花门", "苔石立柱径", "花叶高窗厅", "杜鹃庭院", "花溪拱桥", "双花塔道", "叶幕灯廊", "繁花终点厅"};
            case "obsidian" -> new String[] {"黑曜入口门", "哭泣石柱道", "紫光高窗厅", "黑石祭坛庭", "虚空石桥", "双曜塔道", "紫晶顶廊", "黑曜核心厅"};
            case "gold" -> new String[] {"黄金神门", "金柱礼仪道", "鎏金高窗厅", "太阳徽庭院", "黄金拱桥", "双冠塔道", "金梁灯廊", "宝库终点厅"};
            case "emerald" -> new String[] {"翡翠入口门", "绿晶立柱道", "宝石高窗厅", "翡翠祭坛庭", "碧玉拱桥", "双翠塔道", "晶格灯廊", "翡翠核心厅"};
            case "factory" -> new String[] {"工厂闸门", "钢柱运输道", "机房高窗厅", "装配庭院", "传送带栈桥", "双烟塔道", "钢梁灯廊", "总装终点厅"};
            case "arcade" -> new String[] {"霓虹入口门", "像素立柱道", "游戏高窗厅", "街机广场", "光带玻璃桥", "双屏塔道", "像素顶廊", "冠军终点厅"};
            case "savanna" -> new String[] {"草原城门", "金合欢柱道", "日照高窗厅", "部落庭院", "峡谷木桥", "双塔城道", "藤棚灯廊", "酋长终点厅"};
            case "alpine" -> new String[] {"雪山木门", "松木立柱径", "山景高窗厅", "壁炉庭院", "冰溪木桥", "双峰塔道", "雪棚灯廊", "山庄终点厅"};
            case "jungle" -> new String[] {"藤蔓神庙门", "雨林石柱道", "叶影高窗厅", "图腾庭院", "古树索桥", "双庙塔道", "树冠灯廊", "神庙核心厅"};
            case "coast" -> new String[] {"临海堡门", "礁石立柱道", "海风高窗厅", "炮台庭院", "潮沟石桥", "双堡塔道", "海防梁廊", "灯塔终点厅"};
            case "oasis" -> new String[] {"绿洲城门", "棕榈列柱道", "水景高窗厅", "喷泉庭院", "灌渠石桥", "双塔城道", "遮阳灯廊", "王庭终点厅"};
            case "candy" -> new String[] {"糖霜入口门", "棒糖立柱道", "糖纸高窗厅", "甜点庭院", "奶油拱桥", "双糖塔道", "彩糖灯廊", "糖果终点厅"};
            case "clockwork" -> new String[] {"齿轮城门", "发条立柱道", "钟面高窗厅", "摆轮庭院", "传动栈桥", "双钟塔道", "铜梁灯廊", "时间核心厅"};
            case "marble" -> new String[] {"白石浴场门", "浴场列柱道", "采光高窗厅", "喷泉庭院", "水渠石桥", "双亭塔道", "石梁灯廊", "穹顶浴场厅"};
            case "vineyard" -> new String[] {"葡萄庄园门", "藤架立柱径", "酒窖高窗厅", "品酒庭院", "溪谷木桥", "双庄塔道", "葡萄灯廊", "丰收宴会厅"};
            case "pumpkin" -> new String[] {"南瓜庆典门", "稻草立柱径", "谷仓高窗厅", "南瓜庭院", "田沟木桥", "双仓塔道", "彩旗灯廊", "丰收终点厅"};
            case "aquarium" -> new String[] {"水族入口门", "海草立柱道", "鱼群高窗厅", "珊瑚庭院", "玻璃水桥", "双缸塔道", "水幕灯廊", "海洋核心厅"};
            case "railway" -> new String[] {"车站闸门", "轨枕立柱道", "候车高窗厅", "机车庭院", "铁轨栈桥", "双站塔道", "钢梁灯廊", "总站终点厅"};
            case "harbor" -> new String[] {"船坞入口门", "桅杆立柱道", "仓库高窗厅", "码头庭院", "跨港木桥", "双塔船坞", "吊机灯廊", "港务终点厅"};
            case "cathedral" -> new String[] {"教堂拱门", "礼拜列柱道", "彩窗大厅", "圣徽庭院", "唱诗拱桥", "双钟塔道", "穹架灯廊", "圣坛终点厅"};
            case "dojo" -> new String[] {"道场山门", "木桩立柱径", "纸门高窗厅", "演武庭院", "枯山水桥", "双阁塔道", "竹梁灯廊", "宗师终点厅"};
            case "oriental" -> new String[] {"朱红宫门", "御道列柱径", "雕花高窗厅", "御花庭院", "金水拱桥", "双阙塔道", "飞檐灯廊", "金殿终点厅"};
            case "mesa" -> new String[] {"彩陶峡谷门", "赤砂立柱道", "崖壁高窗厅", "陶纹庭院", "红岩石桥", "双崖塔道", "陶梁灯廊", "峡谷终点厅"};
            case "quarry" -> new String[] {"矿场闸门", "石料立柱道", "采石高窗厅", "吊装庭院", "矿坑栈桥", "双吊塔道", "钢架灯廊", "料场终点厅"};
            case "greenhouse" -> new String[] {"温室玻璃门", "花架立柱径", "日照高窗厅", "喷灌庭院", "水培栈桥", "双棚塔道", "藤架灯廊", "花房终点厅"};
            case "carnival" -> new String[] {"乐园彩门", "旋转立柱道", "票亭高窗厅", "游艺庭院", "彩灯拱桥", "双轮塔道", "旗棚灯廊", "庆典终点厅"};
            case "laboratory" -> new String[] {"实验室气闸", "晶能立柱道", "观察高窗厅", "试验庭院", "能量栈桥", "双控塔道", "管线灯廊", "核心终点厅"};
            case "music" -> new String[] {"乐章入口门", "琴键立柱道", "声场高窗厅", "节拍庭院", "旋律拱桥", "双音塔道", "谱架灯廊", "交响终点厅"};
            case "bakery" -> new String[] {"烘焙坊门", "面包立柱道", "炉房高窗厅", "甜点庭院", "麦香木桥", "双炉塔道", "木梁灯廊", "宴会终点厅"};
            case "volcano" -> new String[] {"火山神门", "熔岩立柱道", "热浪高窗厅", "火祭庭院", "岩浆石桥", "双焰塔道", "玄武灯廊", "火核终点厅"};
            case "lagoon" -> new String[] {"泻湖水门", "棕榈立柱径", "海景高窗厅", "沙洲庭院", "浅湾木桥", "双岛塔道", "珊瑚灯廊", "海湾终点厅"};
            case "autumn" -> new String[] {"秋叶庄园门", "枫木立柱径", "暖阳高窗厅", "落叶庭院", "林溪木桥", "双庄塔道", "叶棚灯廊", "丰收终点厅"};
            case "winter" -> new String[] {"冬日村门", "雪松立柱径", "霜花高窗厅", "冰灯庭院", "冻河木桥", "双钟塔道", "雪棚灯廊", "节庆终点厅"};
            case "dragon" -> new String[] {"龙纹神门", "龙柱御道", "鳞纹高窗厅", "龙徽庭院", "云纹石桥", "双龙塔道", "金梁灯廊", "龙殿终点厅"};
            case "maze" -> new String[] {"迷宫花门", "绿篱立柱径", "花影高窗厅", "喷泉庭院", "花溪拱桥", "双亭塔道", "藤棚灯廊", "花园终点厅"};
            case "observatory" -> new String[] {"星象入口门", "天文立柱道", "观测高窗厅", "日晷庭院", "星轨拱桥", "双镜塔道", "晶格灯廊", "穹顶终点厅"};
            case "stadium" -> new String[] {"竞技场门", "冠军立柱道", "看台高窗厅", "奖杯庭院", "赛道拱桥", "双旗塔道", "顶棚灯廊", "冠军终点厅"};
            default -> new String[] {"村口三拱门", "果园立柱道", "钟楼高窗街", "集市纪念广场", "河畔木桥", "双风车塔道", "藤架灯廊", "庆典终点厅"};
        };
        return names[Math.floorMod(subscene, SUBSCENES_PER_THEME)];
    }

    private void addPath(String name, int stage, Block block) {
        List<Vec3> points = new ArrayList<>();
        int oz = stageZ(stage);
        int startOffset = stage == 0 ? 0 : 1;
        for (int zOffset = startOffset; zOffset <= STAGE_LENGTH; zOffset++) {
            int globalZ = oz + zOffset;
            int x = courseX(globalZ);
            if (isGap(stage, zOffset)) {
                clearGap(x, globalZ);
                continue;
            }

            int blockY = baseY - 1 + pathHeight(stage, zOffset);
            placePathSurface(x, blockY, globalZ, zOffset, block);
            BlockPos horizontal = horizontalPosition(x, globalZ);
            points.add(new Vec3(originX + horizontal.getX() + 0.5, blockY + 1.01, originZ + horizontal.getZ() + 0.5));
        }
        stages.add(new Stage(name, List.copyOf(points)));
    }

    private void protectRoute(String theme, int startStage, int stageCount) {
        for (int stage = startStage; stage < startStage + stageCount; stage++) {
            int oz = stageZ(stage);
            int startOffset = stage == 0 ? 0 : 1;
            Block block = pathBlockForTheme(theme, stage);
            for (int zOffset = startOffset; zOffset <= STAGE_LENGTH; zOffset++) {
                int globalZ = oz + zOffset;
                int x = courseX(globalZ);
                if (isGap(stage, zOffset)) {
                    clearGap(x, globalZ);
                    continue;
                }
                int blockY = baseY - 1 + pathHeight(stage, zOffset);
                placePathSurface(x, blockY, globalZ, zOffset, block);
            }
        }
    }

    private void placePathSurface(int x, int blockY, int globalZ, int zOffset, Block block) {
        for (int supportY = baseY - 1; supportY <= blockY; supportY++) {
            put(x, supportY, globalZ, block);
            put(x + 1, supportY, globalZ, block);
        }
        int stage = Math.max(0, Math.floorDiv(globalZ, STAGE_LENGTH));
        if ("lava".equals(baseTheme) && isLandingMarker(stage, zOffset)) {
            put(x, blockY, globalZ, Blocks.SHROOMLIGHT);
            put(x + 1, blockY, globalZ, Blocks.SHROOMLIGHT);
        }
        if (zOffset % 7 == 3) put(x - 1, blockY, globalZ, block);
        clearHeadroom(x, blockY, globalZ);
        if (zOffset % 6 == 3) {
            put(x - 2, blockY + 3, globalZ, Blocks.LIGHT);
            put(x + 3, blockY + 3, globalZ, Blocks.LIGHT);
        }
    }

    private Block pathBlockForTheme(String theme, int stage) {
        return switch (baseTheme(theme)) {
            case "library" -> libraryPath(sceneIndex(stage));
            case "lava" -> lavaPath(stage);
            case "lush" -> lushPath(stage);
            case "checker" -> checkerPath(stage);
            case "cherry" -> cherryPath(stage);
            case "ice" -> icePath(stage);
            case "honey" -> honeyPath(stage);
            case "nether" -> netherPath(stage);
            case "crystal" -> crystalPath(stage);
            case "village" -> villagePath(stage);
            default -> extendedPalette(baseTheme(theme)).path();
        };
    }

    private void decorateTemplateVariant(int stage) {
        if (templateVariant == 1) return;
        int[] positions = switch (templateVariant) {
            case 2 -> new int[] {12, 36};
            case 3 -> new int[] {16, 32};
            case 4 -> new int[] {24};
            case 5 -> new int[] {10, 24, 38};
            case 6 -> new int[] {8, 20, 32, 44};
            case 7 -> new int[] {10, 26, 42};
            case 8 -> new int[] {7, 15, 23, 31, 39};
            case 9 -> new int[] {18, 36};
            default -> new int[] {9, 21, 33, 45};
        };
        boolean overhead = templateVariant == 3 || templateVariant == 6 || templateVariant == 10;
        int height = switch (templateVariant) {
            case 5, 10 -> 9;
            case 4, 9 -> 5;
            default -> 7;
        };
        int sideDistance = switch (templateVariant) {
            case 4, 9 -> Math.max(9, routeLimit + 3);
            case 8 -> Math.max(5, routeLimit + 1);
            default -> Math.max(6, routeLimit + 2);
        };
        Block frame = templateFrame(stage);
        Block light = templateLight();
        for (int localZ : positions) templateGate(stage, localZ, sideDistance, height, frame, light, overhead);
    }

    private Block templateFrame(int stage) {
        return switch (baseTheme) {
            case "library" -> Blocks.DARK_OAK_PLANKS;
            case "lava" -> lavaWall(stage);
            case "lush" -> Blocks.MOSSY_STONE_BRICKS;
            case "checker" -> Blocks.CONCRETE.red();
            case "honey" -> Blocks.HONEYCOMB_BLOCK;
            case "cherry" -> Blocks.CHERRY_PLANKS;
            case "ice" -> Blocks.BLUE_ICE;
            case "nether" -> Blocks.NETHER_BRICKS;
            case "crystal" -> Blocks.AMETHYST_BLOCK;
            case "village" -> Blocks.STONE_BRICKS;
            default -> extendedPalette(baseTheme).frame();
        };
    }

    private Block templateLight() {
        return switch (baseTheme) {
            case "lava", "nether", "honey" -> Blocks.SHROOMLIGHT;
            case "village", "library", "lush", "checker", "cherry", "ice", "crystal" -> Blocks.SEA_LANTERN;
            default -> extendedPalette(baseTheme).light();
        };
    }

    private void clearKnownDecorations(int stage) {
        int oz = stageZ(stage);
        int[] slices = {5, 7, 10, 14, 18, 24, 30, 35, 38, 41, 43};
        for (int localZ : slices) {
            int z = oz + localZ;
            for (int x = -10; x <= 10; x++) {
                if (Math.abs(x) >= 6) {
                    for (int y = 0; y <= 14; y++) put(x, baseY + y, z, Blocks.AIR);
                }
                for (int y = 6; y <= 14; y++) put(x, baseY + y, z, Blocks.AIR);
            }
        }
    }

    private void templateGate(int stage, int localZ, int sideDistance, int height, Block frame, Block light, boolean overhead) {
        int z = stageZ(stage) + localZ;
        int center = courseX(z);
        int floorY = baseY - 1 + pathHeight(stage, localZ);
        int left = center - sideDistance;
        int right = center + sideDistance + 1;
        for (int y = baseY - 1; y <= floorY + height; y++) {
            put(left, y, z, y == floorY + height - 1 ? light : frame);
            put(right, y, z, y == floorY + height - 1 ? light : frame);
        }
        if (overhead) {
            for (int x = left; x <= right; x++) put(x, floorY + height, z, frame);
            put(center, floorY + height, z, light);
            put(center + 1, floorY + height, z, light);
        }
    }

    private int pathHeight(int stage, int zOffset) {
        int[] keyframes = heightProfiles.computeIfAbsent(stage, this::createHeightProfile);
        return interpolateKeyframes(keyframes, zOffset, HEIGHT_KEYFRAME_SPACING);
    }

    private boolean isGap(int stage, int zOffset) {
        int[] starts = gapProfiles.computeIfAbsent(stage, this::createGapProfile);
        for (int start : starts) {
            if (zOffset == start || zOffset == start + 1) return true;
        }
        return false;
    }

    private boolean isLandingMarker(int stage, int zOffset) {
        int[] starts = gapProfiles.computeIfAbsent(stage, this::createGapProfile);
        for (int start : starts) {
            if (zOffset == start - 1 || zOffset == start + 2) return true;
        }
        return false;
    }

    private void clearGap(int centerX, int z) {
        int left = "lava".equals(baseTheme) ? -3 : -2;
        int right = "lava".equals(baseTheme) ? 4 : 3;
        int top = "lava".equals(baseTheme) ? baseY + 15 : baseY + 13;
        for (int dx = left; dx <= right; dx++) {
            for (int y = baseY - 2; y <= top; y++) {
                put(centerX + dx, y, z, Blocks.AIR);
            }
        }
    }

    private void clearHeadroom(int centerX, int floorY, int z) {
        int left = "lava".equals(baseTheme) ? -3 : -2;
        int right = "lava".equals(baseTheme) ? 4 : 3;
        int top = "lava".equals(baseTheme) ? floorY + 6 : floorY + 5;
        for (int dx = left; dx <= right; dx++) {
            for (int y = floorY + 1; y <= top; y++) {
                put(centerX + dx, y, z, Blocks.AIR);
            }
        }
    }

    private int stageZ(int stage) {
        return stage * STAGE_LENGTH;
    }

    private int courseX(int globalZ) {
        int stage = Math.max(0, Math.floorDiv(globalZ, STAGE_LENGTH));
        int localZ = globalZ - stage * STAGE_LENGTH;
        int[] profile = xProfiles.computeIfAbsent(stage, this::createXProfile);
        int value = interpolateKeyframes(profile, localZ, KEYFRAME_SPACING);
        return Math.max(-routeLimit, Math.min(routeLimit, value));
    }

    private int[] createXProfile(int stage) {
        int[] profile = new int[STAGE_LENGTH / KEYFRAME_SPACING + 1];
        int previous = 0;
        for (int i = 1; i < profile.length - 1; i++) {
            int randomValue = seededInt(stage, 100 + i, routeLimit * 2 + 1) - routeLimit;
            int value = switch (terrainProfile) {
                case 1 -> ((stage + i) & 1) == 0 ? routeLimit : -routeLimit;
                case 2 -> Math.max(-routeLimit, Math.min(routeLimit,
                    (i <= 2 ? 1 : -1) * (Math.max(2, routeLimit - seededInt(stage, 130 + i, 3)))));
                case 3 -> Math.max(-routeLimit, Math.min(routeLimit,
                    randomValue + (((stage + i) & 1) == 0 ? 2 : -2)));
                default -> randomValue;
            };
            if (value == previous) value = value >= routeLimit ? value - 1 : value + 1;
            profile[i] = value;
            previous = value;
        }
        profile[0] = 0;
        profile[profile.length - 1] = 0;
        return profile;
    }

    private int[] createHeightProfile(int stage) {
        int[] profile = new int[STAGE_LENGTH / HEIGHT_KEYFRAME_SPACING + 1];
        int previous = 0;
        int heightBound = switch (templateVariant) {
            case 3, 10 -> 10;
            case 4, 9 -> 6;
            default -> 9;
        };
        heightBound = Math.max(5, Math.min(12, heightBound + terrainProfile - 1));
        for (int i = 1; i < profile.length - 1; i++) {
            int value = switch (terrainProfile) {
                case 1 -> Math.min(heightBound - 1, i * 2 + seededInt(stage, 220 + i, 2));
                case 2 -> Math.max(0, heightBound - 2 - Math.abs(4 - i) * 2);
                case 3 -> seededInt(stage, 230 + i, heightBound);
                default -> seededInt(stage, 200 + i, heightBound);
            };
            if (value > previous + 4) value = previous + 4;
            if (value < previous - 4) value = Math.max(0, previous - 4);
            profile[i] = value;
            previous = value;
        }
        profile[0] = 0;
        profile[profile.length - 1] = 0;
        return profile;
    }

    private int[] createGapProfile(int stage) {
        List<Integer> candidates = new ArrayList<>();
        for (int candidate : SAFE_GAP_CANDIDATES) candidates.add(candidate);
        List<Integer> selected = new ArrayList<>();
        int count = switch (templateVariant) {
            case 4, 9 -> 2;
            case 8, 10 -> 4;
            default -> 2 + seededInt(stage, 300, 3);
        };
        count = Math.max(2, Math.min(4, count + (terrainProfile == 3 ? 1 : 0) - (terrainProfile == 2 ? 1 : 0)));
        for (int i = 0; i < count && !candidates.isEmpty(); i++) {
            int index = seededInt(stage, 301 + i, candidates.size());
            int value = candidates.remove(index);
            selected.add(value);
            candidates.removeIf(candidate -> Math.abs(candidate - value) < 6);
        }
        Collections.sort(selected);
        return selected.stream().mapToInt(Integer::intValue).toArray();
    }

    private int sceneIndex(int stage) {
        return Math.floorMod(stage + seededInt(0, 400, 10) + (templateVariant - 1) * 3, 10);
    }

    private int subsceneIndex(int stage) {
        int cycle = Math.floorDiv(stage, SUBSCENES_PER_THEME);
        int position = Math.floorMod(stage, SUBSCENES_PER_THEME);
        int orderIndex = Math.floorMod(
            sceneOrderProfile + cycle + seededInt(cycle, 451, SUBSCENE_ORDERS.length),
            SUBSCENE_ORDERS.length
        );
        return SUBSCENE_ORDERS[orderIndex][position];
    }

    private int seededInt(int stage, int salt, int bound) {
        if (bound <= 1) return 0;
        long value = mix64(seed
            ^ ((long) templateVariant * 0x94D049BB133111EBL)
            ^ ((long) stage * 0x9E3779B97F4A7C15L)
            ^ ((long) salt * 0xD1B54A32D192ED03L));
        return (int) Math.floorMod(value, bound);
    }

    private static long mix64(long value) {
        value = (value ^ (value >>> 30)) * 0xBF58476D1CE4E5B9L;
        value = (value ^ (value >>> 27)) * 0x94D049BB133111EBL;
        return value ^ (value >>> 31);
    }

    private int interpolateKeyframes(int[] keyframes, int position, int spacing) {
        int bounded = Math.max(0, Math.min(STAGE_LENGTH, position));
        int segment = Math.min(keyframes.length - 2, bounded / spacing);
        double t = (bounded - segment * spacing) / (double) spacing;
        double eased = t * t * (3.0 - 2.0 * t);
        return (int) Math.round(keyframes[segment] + (keyframes[segment + 1] - keyframes[segment]) * eased);
    }

    private void entryArch(int z, Block frame, Block light) {
        for (int y = 0; y <= 5; y++) {
            put(-5, baseY + y, z, frame);
            put(5, baseY + y, z, frame);
        }
        for (int x = -5; x <= 5; x++) put(x, baseY + 5, z, frame);
        put(-4, baseY + 4, z, light);
        put(4, baseY + 4, z, light);
    }

    private void tree(int x, int y, int z) {
        for (int h = 0; h < 4; h++) put(x, y + h, z, Blocks.OAK_LOG);
        for (int dx = -2; dx <= 2; dx++) {
            for (int dz = -2; dz <= 2; dz++) {
                if (Math.abs(dx) + Math.abs(dz) <= 3) put(x + dx, y + 3, z + dz, Blocks.OAK_LEAVES);
                if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1) put(x + dx, y + 4, z + dz, Blocks.OAK_LEAVES);
            }
        }
    }

    private void cherryTree(int x, int y, int z) {
        for (int h = 0; h < 5; h++) put(x, y + h, z, Blocks.CHERRY_LOG);
        for (int dx = -2; dx <= 2; dx++) {
            for (int dz = -2; dz <= 2; dz++) {
                if (Math.abs(dx) + Math.abs(dz) <= 3) put(x + dx, y + 4, z + dz, Blocks.CHERRY_LEAVES);
            }
        }
    }

    private void crystalPillar(int x, int y, int z, int height) {
        for (int h = 0; h < height; h++) {
            put(x, y + h, z, h == height - 1 ? Blocks.SEA_LANTERN : Blocks.AMETHYST_BLOCK);
        }
    }

    private void house(int x, int y, int z) {
        for (int dx = 0; dx < 5; dx++) {
            for (int dz = 0; dz < 5; dz++) {
                put(x + dx, y - 1, z + dz, Blocks.COBBLESTONE);
                for (int dy = 0; dy <= 4; dy++) {
                    boolean wall = dx == 0 || dx == 4 || dz == 0 || dz == 4;
                    if (wall && dy < 4) put(x + dx, y + dy, z + dz, (dx == 0 || dx == 4) ? Blocks.OAK_LOG : Blocks.OAK_PLANKS);
                    if (dy == 4) put(x + dx, y + dy, z + dz, Blocks.DARK_OAK_PLANKS);
                }
            }
        }
    }

    private void lamp(int x, int y, int z) {
        for (int h = 0; h < 3; h++) put(x, y + h, z, Blocks.DARK_OAK_FENCE);
        put(x, y + 3, z, Blocks.GLOWSTONE);
    }

    private BlockPos horizontalPosition(int modelX, int modelZ) {
        int segment = Math.max(0, Math.floorDiv(modelZ, TURN_SEGMENT_LENGTH));
        int localZ = modelZ - segment * TURN_SEGMENT_LENGTH;
        int cycle = segment / 4;
        int direction = segment % 4;
        int cycleZ = cycle * TURN_SEGMENT_LENGTH * 2;
        return switch (direction) {
            case 0 -> new BlockPos(modelX, 0, cycleZ + localZ);
            case 1 -> new BlockPos(localZ, 0, cycleZ + TURN_SEGMENT_LENGTH - modelX);
            case 2 -> new BlockPos(TURN_SEGMENT_LENGTH + modelX, 0, cycleZ + TURN_SEGMENT_LENGTH + localZ);
            default -> new BlockPos(TURN_SEGMENT_LENGTH - localZ, 0, cycleZ + TURN_SEGMENT_LENGTH * 2 + modelX);
        };
    }

    private void put(int x, int y, int z, Block block) {
        BlockPos horizontal = horizontalPosition(x, z);
        blocks.put(new BlockPos(originX + horizontal.getX(), y, originZ + horizontal.getZ()), block.defaultBlockState());
    }
}
