#include <iostream>
#include <vector>
    

int main() {
    // Example: Linear traversal of a vector
    std::vector<int> numbers = {1, 5, 2, 8, 3, 9, 4, 6, 7};

    // Find the maximum element
    int max_element = numbers[0];
    for (size_t i = 1; i < numbers.size(); ++i) {
        if (numbers[i] > max_element) {
            max_element = numbers[i];
        }
    }
    std::cout << "Maximum element: " << max_element << std::endl;

    // Count elements greater than a certain value
    int threshold = 5;
    int count_greater_than_threshold = 0;
    for (int num : numbers) {
        if (num > threshold) {
            count_greater_than_threshold++;
        }
    }
    std::cout << "Elements greater than " << threshold << ": " << count_greater_than_threshold << std::endl;

    // Check if an element exists
    int target = 7;
    bool found = false;
    for (int num : numbers) {
        if (num == target) {
            found = true;
            break;
        }
    }
    if (found) {
        std::cout << target << " found in the vector." << std::endl;
    } else {
        std::cout << target << " not found in the vector." << std::endl;
    }

    // Sum of all elements
    long long sum = 0;
    for (int num : numbers) {
        sum += num;
    }
    std::cout << "Sum of all elements: " << sum << std::endl;

    return 0;
}
