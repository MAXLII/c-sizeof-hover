// SPDX-License-Identifier: MIT
/**
 * @file    primitive-sizes.ts
 * @brief   ARM Cortex-M primitive type size and alignment tables.
 * @details
 *          This file is part of the c-sizeof-hover project.
 *
 *          Module responsibilities:
 *          - Provide default sizes and alignment for all C primitive types
 *          - Support ILP32 ARM EABI (HC32F334) as default
 *          - Support per-project size overrides via ExtensionConfig
 *
 *          Design notes:
 *          - ARM Cortex-M4 is 32-bit little-endian with ILP32 model
 *          - long double == double (8 bytes) on ARM EABI
 *          - _Bool / bool is 1 byte
 *
 * @author  Max.Li
 * @date    2026-05-09
 * @version 1.0.0
 *
 * Copyright (c) 2026 Max.Li.
 * All rights reserved.
 *
 * This file is licensed under the MIT License.
 * See the LICENSE file for full license text.
 */

import { ResolvedType, TypeKind } from './types';

export interface PrimitiveSizeConfig {
  pointerSize: number;
  charSize: number;
  shortSize: number;
  intSize: number;
  longSize: number;
  longLongSize: number;
  floatSize: number;
  doubleSize: number;
  longDoubleSize: number;
  enumSize: number;
  customTypeSizes: Record<string, number>;
}

export const DEFAULT_CONFIG: PrimitiveSizeConfig = {
  pointerSize: 4,
  charSize: 1,
  shortSize: 2,
  intSize: 4,
  longSize: 4,
  longLongSize: 8,
  floatSize: 4,
  doubleSize: 8,
  longDoubleSize: 8,
  enumSize: 4,
  customTypeSizes: {},
};

export function getPrimitiveSize(name: string, config: PrimitiveSizeConfig): number | undefined {
  const n = name.replace(/\s+/g, ' ').trim();
  const s = config; // shorthand
  switch (n) {
    case 'char': case 'signed char': case 'unsigned char':
    case '_Bool': case 'bool':
      return s.charSize;
    case 'short': case 'short int': case 'signed short': case 'signed short int':
    case 'unsigned short': case 'unsigned short int':
      return s.shortSize;
    case 'int': case 'signed': case 'signed int':
    case 'unsigned': case 'unsigned int':
      return s.intSize;
    case 'long': case 'long int': case 'signed long': case 'signed long int':
    case 'unsigned long': case 'unsigned long int':
      return s.longSize;
    case 'long long': case 'long long int': case 'signed long long': case 'signed long long int':
    case 'unsigned long long': case 'unsigned long long int':
      return s.longLongSize;
    case 'float': return s.floatSize;
    case 'double': return s.doubleSize;
    case 'long double': return s.longDoubleSize;
    default: return undefined;
  }
}

export function getPrimitiveAlignment(name: string, config: PrimitiveSizeConfig): number {
  return getPrimitiveSize(name, config) ?? config.intSize;
}

export function getPointerSize(config: PrimitiveSizeConfig): number {
  return config.pointerSize;
}

export function getPointerAlignment(config: PrimitiveSizeConfig): number {
  return config.pointerSize;
}

export function getEnumSize(config: PrimitiveSizeConfig): number {
  return config.enumSize;
}

export function getEnumAlignment(config: PrimitiveSizeConfig): number {
  return config.enumSize;
}

export function getCustomTypeSize(name: string, config: PrimitiveSizeConfig): number | undefined {
  return config.customTypeSizes[name];
}

const BUILTIN_NAMES: Record<string, string> = {
  'uint8_t': 'unsigned char',
  'uint16_t': 'unsigned short',
  'uint32_t': 'unsigned long',
  'uint64_t': 'unsigned long long',
  'int8_t': 'signed char',
  'int16_t': 'signed short',
  'int32_t': 'signed long',
  'int64_t': 'signed long long',
  'size_t': 'unsigned long',
  'uintptr_t': 'unsigned long',
  'intptr_t': 'signed long',
  'ptrdiff_t': 'signed long',
  'wchar_t': 'unsigned short',
  'char16_t': 'unsigned short',
  'char32_t': 'unsigned long',
  'float32_t': 'float',
  'float64_t': 'double',
  'bool': '_Bool',
};

export function resolveBuiltinType(name: string, config: PrimitiveSizeConfig): ResolvedType | undefined {
  const mapped = BUILTIN_NAMES[name];
  if (mapped) {
    const size = getPrimitiveSize(mapped, config);
    if (size !== undefined) {
      return { kind: TypeKind.Primitive, name: mapped, size, alignment: size };
    }
  }
  return undefined;
}

export function isBuiltinType(name: string): boolean {
  return name in BUILTIN_NAMES;
}
