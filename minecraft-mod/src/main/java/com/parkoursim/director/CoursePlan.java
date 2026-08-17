package com.parkoursim.director;

import java.util.List;

import net.minecraft.core.BlockPos;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.Vec3;

public record CoursePlan(List<Placement> placements, List<Stage> stages) {
    public record Placement(BlockPos pos, BlockState state) {
    }

    public record Stage(String name, List<Vec3> waypoints) {
    }
}
