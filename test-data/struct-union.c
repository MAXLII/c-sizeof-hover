#include <stdint.h>

struct point {
    int x;
    int y;
    double z;
};

union data {
    uint32_t word;
    uint16_t halfword[2];
    uint8_t byte[4];
};

struct mixed {
    uint8_t a;
    uint32_t b;
    uint16_t c;
};

struct __attribute__((packed)) packed_struct {
    uint8_t a;
    uint32_t b;
    uint16_t c;
};

struct point pt;
union data my_data;
struct mixed m;
struct packed_struct ps;

void test(void) {
    int cx = pt.x;
    uint8_t val = ps.a;
}
