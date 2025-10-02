package com.urban.environment.backend.entity;

import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Data;

import java.time.Instant;

/**
 * 传感器数据实体类，映射到数据库表sensor_data
 */
@Data
@Entity
@Table(name = "sensor_data")
public class SensorData {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String deviceId;

    private double latitude;

    private double longitude;

    private double pm25;

    private Instant timestamp;

    // AI异常检测结果
    private Boolean isAnomaly;

    private Double anomalyScore;

    private Double confidence;
}
