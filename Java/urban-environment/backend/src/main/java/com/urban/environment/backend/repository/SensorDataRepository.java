package com.urban.environment.backend.repository;

import com.urban.environment.backend.entity.SensorData;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

/**
 * 传感器数据存储库接口
 */
@Repository
public interface SensorDataRepository extends JpaRepository<SensorData, Long> {
    // Spring Data JPA会自动实现基本的CRUD操作
}
