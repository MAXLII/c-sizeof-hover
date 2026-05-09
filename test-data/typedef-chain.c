#include <stdint.h>

typedef unsigned long uint32_t;
typedef uint32_t my_uint;
typedef my_uint register_t;

struct device {
    register_t ctrl;
    register_t status;
};

typedef struct device device_t;

typedef unsigned char byte_t;
typedef byte_t *byte_ptr_t;

device_t dev;
register_t reg_val;
my_uint val;
byte_ptr_t bptr;
