#include <iostream>
#include <vector>
using namespace std;

class PrefixSum {
private:
    vector<int> prefixSum;
    
public:
    // 构造函数，计算前缀和数组
    PrefixSum(const vector<int>& nums) {
        size_t n = nums.size();
        prefixSum.resize(n + 1, 0);
        
        // 计算前缀和：prefixSum[i] = nums[0] + nums[1] + ... + nums[i-1]
        for (size_t i = 0; i < n; i++) {
            prefixSum[i + 1] = prefixSum[i] + nums[i];
        }
    }
    
    // 查询区间 [left, right] 的和（包含两端）
    int rangeSum(int left, int right) {
        return prefixSum[static_cast<size_t>(right) + 1] - prefixSum[static_cast<size_t>(left)];
    }
    
    // 打印前缀和数组
    void printPrefixSum() {
        cout << "前缀和数组: ";
        for (size_t i = 0; i < prefixSum.size(); i++) {
            cout << prefixSum[i] << " ";
        }
        cout << endl;
    }
};

// 一维前缀和的基础示例
void basicPrefixSumExample() {
    cout << "=== 一维前缀和示例 ===" << endl;
    
    vector<int> nums = {1, 3, 5, 7, 9, 2, 4};
    cout << "原数组: ";
    for (int num : nums) {
        cout << num << " ";
    }
    cout << endl;
    
    PrefixSum ps(nums);
    ps.printPrefixSum();
    
    // 查询几个区间的和
    cout << "区间 [1, 3] 的和: " << ps.rangeSum(1, 3) << endl;  // 3+5+7 = 15
    cout << "区间 [0, 4] 的和: " << ps.rangeSum(0, 4) << endl;  // 1+3+5+7+9 = 25
    cout << "区间 [2, 5] 的和: " << ps.rangeSum(2, 5) << endl;  // 5+7+9+2 = 23
    cout << endl;
}

// 二维前缀和实现
class PrefixSum2D {
private:
    vector<vector<int>> prefixSum;
    
public:
    // 构造二维前缀和
    PrefixSum2D(const vector<vector<int>>& matrix) {
        size_t m = matrix.size();
        size_t n = matrix[0].size();
        prefixSum.assign(m + 1, vector<int>(n + 1, 0));
        
        // 计算二维前缀和
        for (size_t i = 1; i <= m; i++) {
            for (size_t j = 1; j <= n; j++) {
                prefixSum[i][j] = matrix[i-1][j-1] + 
                                prefixSum[i-1][j] + 
                                prefixSum[i][j-1] - 
                                prefixSum[i-1][j-1];
            }
        }
    }
    
    // 查询子矩阵 (row1,col1) 到 (row2,col2) 的和
    int rangeSum(int row1, int col1, int row2, int col2) {
        return prefixSum[static_cast<size_t>(row2) + 1][static_cast<size_t>(col2) + 1] - 
               prefixSum[static_cast<size_t>(row1)][static_cast<size_t>(col2) + 1] - 
               prefixSum[static_cast<size_t>(row2) + 1][static_cast<size_t>(col1)] + 
               prefixSum[static_cast<size_t>(row1)][static_cast<size_t>(col1)];
    }
};

// 二维前缀和示例
void twoDimensionalPrefixSumExample() {
    cout << "=== 二维前缀和示例 ===" << endl;
    
    vector<vector<int>> matrix = {
        {3, 0, 1, 4, 2},
        {5, 6, 3, 2, 1},
        {1, 2, 0, 1, 5},
        {4, 1, 0, 1, 7}
    };
    
    cout << "原矩阵:" << endl;
    for (const auto& row : matrix) {
        for (int val : row) {
            cout << val << " ";
        }
        cout << endl;
    }
    
    PrefixSum2D ps2d(matrix);
    
    // 查询子矩阵的和
    cout << "子矩阵 (1,1) 到 (2,3) 的和: " << ps2d.rangeSum(1, 1, 2, 3) << endl;
    cout << "子矩阵 (0,0) 到 (3,4) 的和: " << ps2d.rangeSum(0, 0, 3, 4) << endl;
    cout << endl;
}

// 差分数组（前缀和的逆运算）
void differenceArrayExample() {
    cout << "=== 差分数组示例 ===" << endl;
    
    vector<int> nums = {1, 3, 5, 7, 9};
    size_t n = nums.size();
    vector<int> diff(n);
    
    // 构造差分数组
    diff[0] = nums[0];
    for (size_t i = 1; i < n; i++) {
        diff[i] = nums[i] - nums[i-1];
    }
    
    cout << "原数组: ";
    for (int num : nums) cout << num << " ";
    cout << endl;
    
    cout << "差分数组: ";
    for (int d : diff) cout << d << " ";
    cout << endl;
    
    // 区间更新：给区间 [1, 3] 都加上 5
    size_t left = 1, right = 3;
    int val = 5;
    diff[left] += val;
    if (right + 1 < n) {
        diff[right + 1] -= val;
    }
    
    // 重新计算数组（差分数组的前缀和）
    vector<int> result(n);
    result[0] = diff[0];
    for (size_t i = 1; i < n; i++) {
        result[i] = result[i-1] + diff[i];
    }
    
    cout << "区间 [1,3] 加5后: ";
    for (int num : result) cout << num << " ";
    cout << endl;
    cout << endl;
}

// 前缀和的应用：连续子数组的最大和（Kadane算法）
int maxSubarraySum(const vector<int>& nums) {
    int maxSum = nums[0];
    int currentSum = nums[0];
    
    for (size_t i = 1; i < nums.size(); i++) {
        currentSum = max(nums[i], currentSum + nums[i]);
        maxSum = max(maxSum, currentSum);
    }
    
    return maxSum;
}

// 前缀和应用示例
void prefixSumApplications() {
    cout << "=== 前缀和应用示例 ===" << endl;
    
    // 1. 连续子数组最大和
    vector<int> nums = {-2, 1, -3, 4, -1, 2, 1, -5, 4};
    cout << "数组: ";
    for (int num : nums) cout << num << " ";
    cout << endl;
    cout << "连续子数组最大和: " << maxSubarraySum(nums) << endl;
    
    // 2. 使用前缀和快速查询
    PrefixSum ps(nums);
    cout << "使用前缀和查询各区间:" << endl;
    cout << "区间 [3, 6] 的和: " << ps.rangeSum(3, 6) << endl;
    cout << "区间 [0, 2] 的和: " << ps.rangeSum(0, 2) << endl;
    cout << endl;
}

int main() {
    cout << "前缀和算法详解与应用" << endl;
    cout << "========================" << endl << endl;
    
    // 运行各种示例
    basicPrefixSumExample();
    twoDimensionalPrefixSumExample();
    differenceArrayExample();
    prefixSumApplications();
    
    cout << "前缀和知识点总结:" << endl;
    cout << "1. 一维前缀和: prefixSum[i] = nums[0] + ... + nums[i-1]" << endl;
    cout << "2. 区间查询: sum(l,r) = prefixSum[r+1] - prefixSum[l]" << endl;
    cout << "3. 二维前缀和: 用于快速计算子矩阵的和" << endl;
    cout << "4. 差分数组: 前缀和的逆运算，用于区间更新" << endl;
    cout << "5. 时间复杂度: 预处理O(n)，查询O(1)" << endl;
    
    return 0;
}