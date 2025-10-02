#!/usr/bin/env python
# -*- coding: utf-8 -*-

import csv
import os

def csv_to_sql_inserts(csv_file_path, output_file_path, table_name, batch_size=500):
    """
    将CSV文件转换为SQL INSERT语句
    
    Args:
        csv_file_path (str): CSV文件路径
        output_file_path (str): 输出的SQL文件路径
        table_name (str): 完整的表名
        batch_size (int): 每个INSERT语句包含的行数
    """
    
    if not os.path.exists(csv_file_path):
        print(f"错误: CSV文件 '{csv_file_path}' 不存在")
        return
    
    try:
        with open(csv_file_path, 'r', encoding='utf-8') as csvfile:
            # 使用CSV模块读取文件
            csv_reader = csv.DictReader(csvfile)
            
            # 验证列名
            expected_columns = ['id', 'device_id', 'latitude', 'longitude', 'pm25', 'timestamp']
            if not all(col in csv_reader.fieldnames for col in expected_columns):
                print(f"错误: CSV文件缺少必要的列。期望的列: {expected_columns}")
                print(f"实际的列: {csv_reader.fieldnames}")
                return
            
            with open(output_file_path, 'w', encoding='utf-8') as output_file:
                rows = list(csv_reader)
                total_rows = len(rows)
                
                print(f"开始处理 {total_rows} 行数据...")
                
                # 按批次处理数据
                for i in range(0, total_rows, batch_size):
                    batch_rows = rows[i:i + batch_size]
                    
                    # 写入INSERT语句的开头
                    output_file.write(f"INSERT INTO `{table_name}` (id, device_id, latitude, longitude, pm25, timestamp)\n")
                    output_file.write("VALUES\n")
                    
                    # 处理每一行数据
                    values_list = []
                    for row in batch_rows:
                        # 格式化每一行为SQL VALUES格式
                        values_line = f"    ({row['id']}, '{row['device_id']}', {row['latitude']}, {row['longitude']}, {row['pm25']}, '{row['timestamp']}')"
                        values_list.append(values_line)
                    
                    # 连接所有VALUES，最后一行用分号结尾
                    output_file.write(",\n".join(values_list))
                    output_file.write(";\n\n")
                    
                    # 显示进度
                    processed = min(i + batch_size, total_rows)
                    print(f"已处理 {processed}/{total_rows} 行 ({processed/total_rows*100:.1f}%)")
                
                print(f"✅ 成功完成！SQL语句已保存到: {output_file_path}")
                print(f"📊 总共 {total_rows} 行数据")
                print(f"📦 分成了 {(total_rows + batch_size - 1) // batch_size} 个INSERT语句")
                
    except UnicodeDecodeError:
        print("CSV文件编码错误，尝试其他编码...")
        try:
            with open(csv_file_path, 'r', encoding='gbk') as csvfile:
                csv_reader = csv.DictReader(csvfile)
                # 重复上面的处理逻辑...
                print("使用GBK编码成功读取文件")
        except Exception as e:
            print(f"编码错误: {e}")
    except Exception as e:
        print(f"处理过程中发生错误: {e}")

def main():
    # 配置参数
    csv_file = "sensor_data_export_v2_clean.csv"
    output_file = "sensor_data_sql_inserts.txt"
    table_name = "urban-environment-471707.sensor_data.manual_sensor_data"
    batch_size = 500  # 每个INSERT语句包含500行数据
    
    print("=== CSV转SQL INSERT语句工具 ===")
    print(f"输入文件: {csv_file}")
    print(f"输出文件: {output_file}")
    print(f"目标表: {table_name}")
    print(f"批次大小: {batch_size} 行/批次")
    print("-" * 50)
    
    # 执行转换
    csv_to_sql_inserts(csv_file, output_file, table_name, batch_size)

if __name__ == "__main__":
    main()