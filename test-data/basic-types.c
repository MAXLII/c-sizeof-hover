#include <stdint.h>

int global_int;
char global_char;
long global_long;
long long global_ll;
float global_float;
double global_double;

int *ptr_int;
int arr[10];
uint32_t reg_value;

enum status { OK = 0, ERROR = 1 };
enum status current_status;

void func(int a, char b) {
    int local_var;
    local_var = a + 1;
}
