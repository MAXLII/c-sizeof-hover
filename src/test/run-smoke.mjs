// Smoke test for C Sizeof Hover type system
// Run: node --import tsx src/test/run-smoke.mjs
import sizeCalculator from '../type-system/size-calculator.ts';
import primitiveSizes from '../type-system/primitive-sizes.ts';
import typeSystem from '../type-system/types.ts';
import typeResolver from '../type-system/type-resolver.ts';
import parserModule from '../parser/c-type-parser.ts';

const { calculateSize } = sizeCalculator;
const { DEFAULT_CONFIG } = primitiveSizes;
const { TypeKind } = typeSystem;
const { resolveThroughTypedefs, formatTypeName } = typeResolver;
const { CTypeParser } = parserModule;

const config = DEFAULT_CONFIG;

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
    if (actual === expected) {
        console.log(`  OK: ${label} = ${expected}`);
        passed++;
    } else {
        console.log(`  FAIL: ${label} = ${actual} (expected ${expected})`);
        failed++;
    }
}

// Test primitive sizes
console.log('=== Primitive Sizes ===');
check('char', calculateSize({ kind: TypeKind.Primitive, name: 'char' }, config).size, 1);
check('int', calculateSize({ kind: TypeKind.Primitive, name: 'int' }, config).size, 4);
check('long', calculateSize({ kind: TypeKind.Primitive, name: 'long' }, config).size, 4);
check('long long', calculateSize({ kind: TypeKind.Primitive, name: 'long long' }, config).size, 8);
check('float', calculateSize({ kind: TypeKind.Primitive, name: 'float' }, config).size, 4);
check('double', calculateSize({ kind: TypeKind.Primitive, name: 'double' }, config).size, 8);

// Test pointer
console.log('\n=== Pointer ===');
check('int*', calculateSize({ kind: TypeKind.Pointer, pointeeType: { kind: TypeKind.Primitive, name: 'int' } }, config).size, 4);

// Test array
console.log('\n=== Array ===');
const arr = { kind: TypeKind.Array, elementType: { kind: TypeKind.Primitive, name: 'int' }, elementCount: 10 };
check('int[10]', calculateSize(arr, config).size, 40);

// Test struct
console.log('\n=== Struct (point: int x, int y, double z) ===');
const point = {
    kind: TypeKind.Struct,
    name: 'point',
    members: [
        { name: 'x', type: { kind: TypeKind.Primitive, name: 'int' }, offset: 0 },
        { name: 'y', type: { kind: TypeKind.Primitive, name: 'int' }, offset: 0 },
        { name: 'z', type: { kind: TypeKind.Primitive, name: 'double' }, offset: 0 },
    ],
};
calculateSize(point, config);
check('struct point sizeof', point.size, 16); // 4+4+8, aligned to 8: 16 total

// Verify member offsets
check('  offset x', point.members[0].offset, 0);
check('  offset y', point.members[1].offset, 4);
check('  offset z', point.members[2].offset, 8);

// Test packed struct
console.log('\n=== Packed Struct (uint8_t a, uint32_t b) ===');
const packed = {
    kind: TypeKind.Struct,
    isPacked: true,
    name: 'packed',
    members: [
        { name: 'a', type: { kind: TypeKind.Primitive, name: 'unsigned char' }, offset: 0 },
        { name: 'b', type: { kind: TypeKind.Primitive, name: 'unsigned long' }, offset: 0 },
    ],
};
calculateSize(packed, config);
check('packed struct sizeof', packed.size, 5); // 1+4, no padding

// Test union
console.log('\n=== Union ===');
const union = {
    kind: TypeKind.Union,
    name: 'data',
    members: [
        { name: 'word', type: { kind: TypeKind.Primitive, name: 'unsigned long' }, offset: 0 },
        { name: 'bytes', type: { kind: TypeKind.Array, elementType: { kind: TypeKind.Primitive, name: 'unsigned char' }, elementCount: 4 }, offset: 0 },
    ],
};
const unionSz = calculateSize(union, config);
check('union data sizeof', unionSz.size, 4); // max(4, 4) aligned to 4

// Test typedef chain
console.log('\n=== Typedef Chain ===');
const uint32 = {
    kind: TypeKind.Typedef,
    name: 'uint32_t',
    aliasFor: { kind: TypeKind.Primitive, name: 'unsigned long' },
};
const resolved = resolveThroughTypedefs(uint32);
check('typedef chain', formatTypeName(resolved), 'unsigned long');
check('typedef sizeof', calculateSize(resolved, config).size, 4);

// Test parser coverage for function parameters and chained member arrays.
console.log('\n=== Parser Function Scope And Member Chain ===');
const parser = new CTypeParser();
const table = parser.parse(`
typedef enum { FSM_A = 0, FSM_B } fsm_sta_t;
typedef struct { float i_act; } input_t;
typedef struct { input_t input; } l_loop_t;
typedef struct { l_loop_t l_loop[2]; } inter_t;
typedef struct { inter_t inter; } buck_boost_t;
typedef enum {
    BUCK_BOOST_MODE_BUCK,
    BUCK_BOOST_MODE_BOOST,
    BUCK_BOOST_MODE_BUCK_BOOST,
} BUCK_BOOST_MODE_DUTY_E;
typedef struct {
    float v_l;
    float v_in;
    float v_out;
} buck_boost_mode_input_t;
typedef struct {
    BUCK_BOOST_MODE_DUTY_E mode;
} buck_boost_mode_inter_t;
typedef struct {
    float buck_duty;
    float boost_duty;
    uint8_t is_half_freq;
} buck_boost_mode_output_t;
#pragma pack(push, 1)
typedef struct {
    uint8_t a;
    uint32_t b;
} pragma_pack_push_t;
#pragma pack(pop)
#pragma pack(1)
typedef struct {
    uint8_t a;
    uint32_t b;
} pragma_pack_set_t;
#pragma pack()
typedef struct {
    buck_boost_mode_input_t input;
    buck_boost_mode_inter_t inter;
    buck_boost_mode_output_t output;
} buck_boost_mode_t;
typedef struct {
    const char *p_name;
    uint32_t fsm_sta;
    void (*func_in)(void);
    void (*func_exe)(void);
    uint32_t (*func_chk)(uint32_t);
    void (*func_out)(void);
} reg_fsm_func_t;
#define REG_WG_COM(cmd_set, func)            \
    reg_wg_com_t reg_wg_com_##cmd_set = {    \
        .cmd = (cmd_set),                    \
        .p_func = (func),                    \
        .p_next = NULL,                      \
    };                                       \
    REG_SECTION_FUNC(SECTION_WG_COM, reg_wg_com_##cmd_set)
typedef struct reg_wg_com {
    uint8_t cmd;
    void (*p_func)(void *p_frame);
    struct reg_wg_com *p_next;
} reg_wg_com_t;
static void buck_boost_l_close_loop(buck_boost_t *str, float i_ref, uint32_t i) {
    str->inter.l_loop[i].input.i_act = i_ref;
}
`);
const strParam = table.globalScope.symbols.get('str');
const iRefParam = table.globalScope.symbols.get('i_ref');
const buckBoost = resolveThroughTypedefs(table.typedefs.get('buck_boost_t'));
const interMember = resolveThroughTypedefs(buckBoost.members.find(m => m.name === 'inter').type);
const lLoopMember = interMember.members.find(m => m.name === 'l_loop').type;
const enumType = resolveThroughTypedefs(table.typedefs.get('fsm_sta_t'));
const regFsm = resolveThroughTypedefs(table.typedefs.get('reg_fsm_func_t'));
const buckBoostMode = resolveThroughTypedefs(table.typedefs.get('buck_boost_mode_t'));
const buckBoostModeEnum = resolveThroughTypedefs(table.typedefs.get('BUCK_BOOST_MODE_DUTY_E'));
const regWgCom = resolveThroughTypedefs(table.typedefs.get('reg_wg_com_t'));
const pragmaPackPush = resolveThroughTypedefs(table.typedefs.get('pragma_pack_push_t'));
const pragmaPackSet = resolveThroughTypedefs(table.typedefs.get('pragma_pack_set_t'));
check('function param str parsed', strParam?.type.kind, TypeKind.Pointer);
check('function param i_ref sizeof', calculateSize(resolveThroughTypedefs(iRefParam.type), config).size, 4);
check('chained array member sizeof', calculateSize(resolveThroughTypedefs(lLoopMember), config).size, 8);
check('typedef enum sizeof', calculateSize(enumType, config).size, 4);
check('function pointer struct member count', regFsm.members.length, 6);
check('function pointer struct sizeof', calculateSize(regFsm, config).size, 24);
check('buck boost mode enum sizeof', calculateSize(buckBoostModeEnum, config).size, 4);
check('buck boost mode struct sizeof', calculateSize(buckBoostMode, config).size, 28);
check('tagged typedef struct member count', regWgCom.members.length, 3);
check('tagged typedef struct sizeof', calculateSize(regWgCom, config).size, 12);
check('pragma pack push sizeof', calculateSize(pragmaPackPush, config).size, 5);
check('pragma pack set sizeof', calculateSize(pragmaPackSet, config).size, 5);

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
