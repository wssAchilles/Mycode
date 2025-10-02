package com.urban.environment.backend.controller;

import com.urban.environment.backend.dto.HeatmapData;
import com.urban.environment.backend.entity.SensorData;
import com.urban.environment.backend.repository.SensorDataRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.stream.Collectors;

/**
 * 数据控制器，处理传感器数据的API请求
 */
@RestController
@RequestMapping("/api/data")
@CrossOrigin("*")
public class DataController {

    private final SensorDataRepository sensorDataRepository;

    @Autowired
    public DataController(SensorDataRepository sensorDataRepository) {
        this.sensorDataRepository = sensorDataRepository;
    }

    /**
     * 获取所有传感器数据
     * 
     * @return 传感器数据列表
     */
    @GetMapping("/latest")
    public List<SensorData> getLatestData() {
        // 简化版MVP实现，直接返回所有数据
        // 在实际生产环境中，可以考虑分页或者只返回最近的N条记录
        return sensorDataRepository.findAll();
    }

    /**
     * 获取热力图数据
     * 返回专门用于Google Maps热力图层的格式化数据
     * 
     * @return 热力图数据列表，包含纬度、经度和权重（PM2.5值）
     */
    @GetMapping("/heatmap")
    public List<HeatmapData> getHeatmapData() {
        // 查询所有传感器数据
        List<SensorData> allSensorData = sensorDataRepository.findAll();

        // 转换为热力图数据格式
        return allSensorData.stream()
                .map(data -> new HeatmapData(
                        data.getLatitude(), // lat
                        data.getLongitude(), // lng
                        data.getPm25() // weight (使用PM2.5值作为热力图权重)
                ))
                .collect(Collectors.toList());
    }
}
