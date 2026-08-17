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
    private static final int[] SAFE_GAP_CANDIDATES = {7, 10, 13, 16, 29, 32, 35, 38, 41};
    private final Map<BlockPos, BlockState> blocks = new LinkedHashMap<>();
    private final List<Stage> stages = new ArrayList<>();
    private final int originX;
    private final int originZ;
    private final int baseY;
    private final int routeLimit;
    private final String theme;
    private final long seed;
    private final Map<Integer, int[]> xProfiles = new HashMap<>();
    private final Map<Integer, int[]> heightProfiles = new HashMap<>();
    private final Map<Integer, int[]> gapProfiles = new HashMap<>();

    private CourseBuilder(BlockPos playerOrigin, String theme, long seed) {
        originX = playerOrigin.getX();
        originZ = playerOrigin.getZ();
        baseY = Math.max(-48, Math.min(240, playerOrigin.getY()));
        this.theme = theme;
        this.seed = seed;
        routeLimit = switch (theme) {
            case "lava", "nether" -> 3;
            case "honey", "cherry" -> 4;
            default -> 5;
        };
    }

    public static CoursePlan plan(BlockPos playerOrigin, String theme) {
        CourseBuilder builder = new CourseBuilder(playerOrigin, theme, 0L);
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
        builder.foundation(stage);
        builder.buildTheme(theme, stage);
        int protectedStart = Math.max(0, stage - 1);
        builder.protectRoute(theme, protectedStart, stage - protectedStart + 1);
        List<Placement> placements = builder.blocks.entrySet().stream()
            .map(entry -> new Placement(entry.getKey(), entry.getValue()))
            .toList();
        return new CoursePlan(placements, List.copyOf(builder.stages));
    }

    public static String themeName(String theme) {
        return switch (theme) {
            case "library" -> "高层图书馆";
            case "lava" -> "熔岩峡谷";
            case "lush" -> "繁茂洞穴";
            case "checker" -> "红白花园";
            case "honey" -> "蜂巢矿洞";
            case "cherry" -> "樱花高塔";
            case "ice" -> "冰晶宫殿";
            case "nether" -> "下界熔炉";
            case "crystal" -> "紫晶花园";
            default -> "村庄花园";
        };
    }

    private void buildTheme(String theme, int stage) {
        switch (theme) {
            case "library" -> library(stage);
            case "lava" -> lavaCanyon(stage);
            case "lush" -> lushCave(stage);
            case "checker" -> checkerGarden(stage);
            case "honey" -> honeyMine(stage);
            case "cherry" -> sunsetTower(stage);
            case "ice" -> icePalace(stage);
            case "nether" -> netherForge(stage);
            case "crystal" -> crystalGarden(stage);
            default -> village(stage);
        }
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
        for (int localZ = 0; localZ <= STAGE_LENGTH; localZ++) {
            int z = oz + localZ;
            for (int x = -11; x <= 11; x++) {
                put(x, baseY - 2, z, Blocks.DIRT);
                put(x, baseY - 1, z, Math.abs(x - courseX(z)) < 2 ? Blocks.DIRT_PATH : Blocks.GRASS_BLOCK);
            }
        }
        for (int localZ : new int[] {5, 17, 29, 41}) {
            tree(-8, baseY, oz + localZ);
            tree(8, baseY, oz + localZ + 3);
        }
        house(-11, baseY, oz + 9);
        house(7, baseY, oz + 30);
        for (int localZ = 4; localZ < STAGE_LENGTH; localZ += 8) {
            lamp(5, baseY, oz + localZ);
        }
        addPath("村庄花园", stage, Blocks.MOSS_BLOCK);
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
        for (int localZ = 0; localZ <= STAGE_LENGTH; localZ++) {
            int z = oz + localZ;
            for (int x = -10; x <= 10; x++) {
                put(x, baseY - 4, z, Math.abs(x) < 4 ? Blocks.BLUE_ICE : Blocks.MOSS_BLOCK);
                if (Math.abs(x) < 5) {
                    for (int y = -3; y <= -1; y++) put(x, baseY + y, z, Blocks.AIR);
                }
                int edge = Math.abs(x);
                if (edge >= 7) {
                    for (int y = -3; y <= 10; y++) {
                        Block type = (x + y + localZ) % 9 == 0 ? Blocks.MOSS_BLOCK : Blocks.DEEPSLATE;
                        put(x, baseY + y, z, type);
                    }
                }
                if (edge > 4) put(x, baseY + 10, z, Blocks.DEEPSLATE);
            }
            if (localZ % 7 == 0) {
                put(-6, baseY + 5, z, Blocks.GLOWSTONE);
                put(6, baseY + 3, z, Blocks.GLOWSTONE);
            }
        }
        for (int localZ = 4; localZ < STAGE_LENGTH; localZ += 7) {
            tree(-5, baseY, oz + localZ);
            tree(5, baseY, oz + localZ + 2);
        }
        entryArch(oz + 1, Blocks.MOSSY_STONE_BRICKS, Blocks.GLOWSTONE);
        addPath("繁茂洞穴", stage, Blocks.MOSSY_STONE_BRICKS);
    }

    private void checkerGarden(int stage) {
        int oz = stageZ(stage);
        for (int localZ = 0; localZ <= STAGE_LENGTH; localZ++) {
            int z = oz + localZ;
            for (int x = -10; x <= 10; x++) {
                put(x, baseY - 1, z, Math.abs(x) < 4 ? Blocks.GRASS_BLOCK : Blocks.DIRT);
            }
            for (int y = 0; y <= 9; y++) {
                Block left = ((localZ + y) & 1) == 0 ? Blocks.CONCRETE.red() : Blocks.CONCRETE.white();
                Block right = left == Blocks.CONCRETE.red() ? Blocks.CONCRETE.white() : Blocks.CONCRETE.red();
                put(-8, baseY + y, z, left);
                put(-9, baseY + y, z, right);
                put(8, baseY + y, z, right);
                put(9, baseY + y, z, left);
            }
        }
        for (int localZ = 6; localZ < STAGE_LENGTH; localZ += 10) {
            lamp(-5, baseY, oz + localZ);
            lamp(5, baseY, oz + localZ + 3);
        }
        entryArch(oz + 1, Blocks.CONCRETE.red(), Blocks.SEA_LANTERN);
        addPath("红白花园", stage, Blocks.QUARTZ_BLOCK);
    }

    private void honeyMine(int stage) {
        int oz = stageZ(stage);
        for (int localZ = 0; localZ <= STAGE_LENGTH; localZ++) {
            int z = oz + localZ;
            for (int x = -9; x <= 9; x++) {
                put(x, baseY - 3, z, Blocks.DEEPSLATE);
                if (Math.abs(x) >= 6) {
                    for (int y = -2; y <= 9; y++) {
                        Block type = (x * x + y + localZ) % 6 == 0 ? Blocks.HONEYCOMB_BLOCK : Blocks.COBBLED_DEEPSLATE;
                        put(x, baseY + y, z, type);
                    }
                }
                if (Math.abs(x) > 3) put(x, baseY + 9, z, Blocks.COBBLED_DEEPSLATE);
            }
            if (localZ % 6 == 0) {
                put(-5, baseY + 4, z, Blocks.GLOWSTONE);
                put(5, baseY + 6, z, Blocks.GLOWSTONE);
            }
        }
        for (int localZ = 5; localZ < STAGE_LENGTH; localZ += 10) {
            entryArch(oz + localZ, Blocks.SPRUCE_PLANKS, Blocks.GLOWSTONE);
        }
        addPath("蜂巢矿洞", stage, Blocks.SPRUCE_PLANKS);
    }

    private void sunsetTower(int stage) {
        int oz = stageZ(stage);
        for (int localZ = 0; localZ <= STAGE_LENGTH; localZ++) {
            int z = oz + localZ;
            for (int x = -10; x <= 10; x++) {
                if (Math.abs(x) >= 6) {
                    int height = 5 + Math.floorMod(x + localZ, 5);
                    for (int y = -3; y <= height; y++) {
                        put(x, baseY + y, z, (x + y + localZ) % 7 == 0 ? Blocks.CHERRY_PLANKS : Blocks.SMOOTH_SANDSTONE);
                    }
                } else {
                    put(x, baseY - 2, z, Blocks.GRASS_BLOCK);
                }
            }
        }
        for (int localZ = 4; localZ <= STAGE_LENGTH - 4; localZ += 8) {
            cherryTree(-5, baseY, oz + localZ);
            cherryTree(5, baseY, oz + localZ + 3);
        }
        entryArch(oz + 1, Blocks.CHERRY_PLANKS, Blocks.GLOWSTONE);
        addPath("樱花高塔", stage, Blocks.QUARTZ_BLOCK);
    }

    private void icePalace(int stage) {
        int oz = stageZ(stage);
        for (int localZ = 0; localZ <= STAGE_LENGTH; localZ++) {
            int z = oz + localZ;
            for (int x = -9; x <= 9; x++) {
                put(x, baseY - 2, z, Blocks.SNOW_BLOCK);
                put(x, baseY - 1, z, Math.abs(x) < 4 ? Blocks.PACKED_ICE : Blocks.BLUE_ICE);
                if (Math.abs(x) >= 7) {
                    for (int y = 0; y <= 8; y++) {
                        put(x, baseY + y, z, (localZ + y) % 6 == 0 ? Blocks.SEA_LANTERN : Blocks.PACKED_ICE);
                    }
                }
            }
            if (localZ % 8 == 0) {
                put(-5, baseY + 2, z, Blocks.SEA_LANTERN);
                put(5, baseY + 4, z, Blocks.SEA_LANTERN);
            }
        }
        for (int localZ = 7; localZ < STAGE_LENGTH; localZ += 12) {
            entryArch(oz + localZ, Blocks.BLUE_ICE, Blocks.SEA_LANTERN);
        }
        addPath("冰晶宫殿", stage, Blocks.QUARTZ_BLOCK);
    }

    private void netherForge(int stage) {
        int oz = stageZ(stage);
        for (int localZ = 0; localZ <= STAGE_LENGTH; localZ++) {
            int z = oz + localZ;
            for (int x = -10; x <= 10; x++) {
                if (Math.abs(x) <= 4) {
                    put(x, baseY - 4, z, Blocks.MAGMA_BLOCK);
                    put(x, baseY - 3, z, Math.abs(x) <= 3 ? Blocks.LAVA : Blocks.BLACKSTONE);
                    for (int y = -2; y <= -1; y++) put(x, baseY + y, z, Blocks.AIR);
                } else {
                    for (int y = -3; y <= 8; y++) {
                        put(x, baseY + y, z, (x + y + localZ) % 8 == 0 ? Blocks.NETHER_BRICKS : Blocks.BLACKSTONE);
                    }
                }
            }
            if (localZ % 7 == 0) {
                put(-6, baseY + 4, z, Blocks.SHROOMLIGHT);
                put(6, baseY + 6, z, Blocks.SHROOMLIGHT);
            }
        }
        for (int localZ = 4; localZ < STAGE_LENGTH; localZ += 9) {
            entryArch(oz + localZ, Blocks.NETHER_BRICKS, Blocks.SHROOMLIGHT);
        }
        addPath("下界熔炉", stage, Blocks.BLACKSTONE);
    }

    private void crystalGarden(int stage) {
        int oz = stageZ(stage);
        for (int localZ = 0; localZ <= STAGE_LENGTH; localZ++) {
            int z = oz + localZ;
            for (int x = -10; x <= 10; x++) {
                put(x, baseY - 2, z, Blocks.CALCITE);
                put(x, baseY - 1, z, Math.abs(x) < 5 ? Blocks.MOSS_BLOCK : Blocks.AMETHYST_BLOCK);
                if (Math.abs(x) >= 8) {
                    for (int y = 0; y <= 9; y++) {
                        Block type = (x + y + localZ) % 5 == 0 ? Blocks.AMETHYST_BLOCK : Blocks.CALCITE;
                        put(x, baseY + y, z, type);
                    }
                }
            }
        }
        for (int localZ = 4; localZ < STAGE_LENGTH; localZ += 8) {
            crystalPillar(-5, baseY, oz + localZ, 3 + localZ % 4);
            crystalPillar(5, baseY, oz + localZ + 3, 4 + localZ % 3);
        }
        entryArch(oz + 1, Blocks.AMETHYST_BLOCK, Blocks.SEA_LANTERN);
        addPath("紫晶花园", stage, Blocks.PURPUR_BLOCK);
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
        if ("lava".equals(theme) && isLandingMarker(stage, zOffset)) {
            put(x, blockY, globalZ, Blocks.SHROOMLIGHT);
            put(x + 1, blockY, globalZ, Blocks.SHROOMLIGHT);
        }
        if (zOffset % 7 == 3) put(x - 1, blockY, globalZ, block);
        clearHeadroom(x, blockY, globalZ);
    }

    private Block pathBlockForTheme(String theme, int stage) {
        return switch (theme) {
            case "library" -> libraryPath(sceneIndex(stage));
            case "lava" -> lavaPath(stage);
            case "lush" -> Blocks.MOSSY_STONE_BRICKS;
            case "checker", "cherry", "ice" -> Blocks.QUARTZ_BLOCK;
            case "honey" -> Blocks.SPRUCE_PLANKS;
            case "nether" -> Blocks.BLACKSTONE;
            case "crystal" -> Blocks.PURPUR_BLOCK;
            default -> Blocks.MOSS_BLOCK;
        };
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
        int left = "lava".equals(theme) ? -3 : -2;
        int right = "lava".equals(theme) ? 4 : 3;
        int top = "lava".equals(theme) ? baseY + 15 : baseY + 13;
        for (int dx = left; dx <= right; dx++) {
            for (int y = baseY - 2; y <= top; y++) {
                put(centerX + dx, y, z, Blocks.AIR);
            }
        }
    }

    private void clearHeadroom(int centerX, int floorY, int z) {
        int left = "lava".equals(theme) ? -3 : -2;
        int right = "lava".equals(theme) ? 4 : 3;
        int top = "lava".equals(theme) ? floorY + 6 : floorY + 5;
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
            int value = seededInt(stage, 100 + i, routeLimit * 2 + 1) - routeLimit;
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
        for (int i = 1; i < profile.length - 1; i++) {
            int value = seededInt(stage, 200 + i, 9);
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
        int count = 2 + seededInt(stage, 300, 3);
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
        return Math.floorMod(stage + seededInt(0, 400, 10), 10);
    }

    private int seededInt(int stage, int salt, int bound) {
        if (bound <= 1) return 0;
        long value = mix64(seed ^ ((long) stage * 0x9E3779B97F4A7C15L) ^ ((long) salt * 0xD1B54A32D192ED03L));
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
