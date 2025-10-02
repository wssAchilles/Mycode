import pandas as pd

def generate_sql_inserts_from_csv(csv_file_path, table_name, output_txt_path, chunk_size=500):
    """
    Reads a CSV file and generates SQL INSERT statements in chunks.

    Args:
        csv_file_path (str): The path to the input CSV file.
        table_name (str): The full BigQuery table name (e.g., `project.dataset.table`).
        output_txt_path (str): The path for the output .txt file.
        chunk_size (int): The number of rows to include in each INSERT statement.
    """
    try:
        # Read the entire CSV file with different encoding options
        try:
            df = pd.read_csv(csv_file_path, encoding='utf-8-sig')  # utf-8-sig handles BOM
        except UnicodeDecodeError:
            try:
                df = pd.read_csv(csv_file_path, encoding='utf-8')
            except UnicodeDecodeError:
                try:
                    df = pd.read_csv(csv_file_path, encoding='gbk')
                except UnicodeDecodeError:
                    df = pd.read_csv(csv_file_path, encoding='latin1')
        
        print(f"CSV文件加载成功，共 {len(df)} 行")
        print(f"列名: {list(df.columns)}")
        print(f"前几行数据:")
        print(df.head())
        
        # Open the output file
        with open(output_txt_path, 'w', encoding='utf-8') as f:
            
            # Process the DataFrame in chunks
            for i in range(0, len(df), chunk_size):
                chunk_df = df.iloc[i:i + chunk_size]
                
                # Start building the INSERT statement for the current chunk
                sql_statement = f"INSERT INTO `{table_name}` (id, device_id, latitude, longitude, pm25, timestamp)\nVALUES\n"
                
                values_list = []
                for index, row in chunk_df.iterrows():
                    # Format each row into a SQL VALUES tuple.
                    # String and timestamp values are enclosed in single quotes.
                    values_list.append(
                        f"    ({row['id']}, '{row['device_id']}', {row['latitude']}, {row['longitude']}, {row['pm25']}, '{row['timestamp']}')"
                    )
                
                # Join all the value strings with a comma and newline
                sql_statement += ",\n".join(values_list) + ";\n\n"
                
                # Write the complete INSERT statement for the chunk to the file
                f.write(sql_statement)
                
        print(f"成功！SQL语句已生成并保存到文件: {output_txt_path}")
        print(f"总共 {len(df)} 行数据被分成了 { (len(df) + chunk_size - 1) // chunk_size } 个INSERT语句。")

    except FileNotFoundError:
        print(f"错误: 文件 '{csv_file_path}' 未找到。")
    except Exception as e:
        print(f"处理过程中发生错误: {e}")

# --- 配置您的信息 ---
# CSV文件名 (与您上传的文件名一致)
csv_file = 'sensor_data_export_v2_clean.csv'

# 您在BigQuery中的完整表名 (请根据需要修改)
# 格式: `项目ID.数据集ID.表名`
full_table_name = 'urban-environment-471707.sensor_data.manual_sensor_data'

# 您希望生成的txt文件名
output_file = 'sql_insert_statements.txt'

# --- 运行脚本 ---
generate_sql_inserts_from_csv(csv_file, full_table_name, output_file)