# C Sizeof Hover

VS Code 扩展。鼠标悬停在 C 变量或类型名上时，显示 `sizeof` 值及结构体内存布局。

## 功能

- 悬停显示 `sizeof` 值（基本类型、指针、数组、结构体、联合体、枚举）
- 结构体/联合体成员偏移量和内存布局
- typedef 链路追踪
- 位域支持
- 函数指针成员识别
- CMSIS 限定符（`__IO`、`__IM`、`__OM`）兼容
- 跨文件类型解析（通过 `#include "..."` 追踪）

## 配置

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| `c-sizeof-hover.pointerSize` | 4 | 指针大小（字节） |
| `c-sizeof-hover.intSize` | 4 | int 大小 |
| `c-sizeof-hover.longSize` | 4 | long 大小（ARM ILP32） |
| `c-sizeof-hover.showAlignment` | true | 显示结构体成员偏移和布局 |
| `c-sizeof-hover.showTypedefChain` | true | 显示 typedef 解析链路 |
| `c-sizeof-hover.customTypeSizes` | {} | 自定义类型大小覆盖 |
| `c-sizeof-hover.debug` | false | 启用诊断日志（Output → C Sizeof Hover） |

完整配置项见 `package.json` 的 `contributes.configuration`。

## 开发

```bash
npm install
npm run compile      # 单次编译
npm run watch        # 监听编译
```

F5 启动 Extension Development Host 调试。
