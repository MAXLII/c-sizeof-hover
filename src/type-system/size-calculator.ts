// SPDX-License-Identifier: MIT
/**
 * @file    size-calculator.ts
 * @brief   sizeof calculator with struct/union alignment for ARM Cortex-M.
 * @details
 *          This file is part of the c-sizeof-hover project.
 *
 *          Module responsibilities:
 *          - Calculate sizeof for all C type kinds
 *          - Apply natural alignment rules (ARM EABI)
 *          - Handle struct member offsets and trailing padding
 *          - Handle unions (size = max member, aligned to max member alignment)
 *          - Handle arrays, pointers, enums, typedef chains
 *          - Respect __packed / __attribute__((packed))
 *
 *          Design notes:
 *          - ILP32: int=4, long=4, ptr=4
 *          - ARM natural alignment: member alignment = min(size, 8) for scalars
 *          - Struct alignment = max(member alignments)
 *          - Trailing padding rounds struct size up to struct alignment
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
import {
  PrimitiveSizeConfig,
  getPrimitiveSize,
  getPointerSize,
  getPointerAlignment,
  getEnumSize,
  getEnumAlignment,
  getCustomTypeSize,
} from './primitive-sizes';

export interface SizeResult {
  size: number;
  alignment: number;
}

/**
 * Main entry: calculate sizeof for any resolved type.
 * Returns SizeResult or undefined for incomplete types.
 */
export function calculateSize(type: ResolvedType, config: PrimitiveSizeConfig): SizeResult | undefined {
  const visited = new Set<string>();
  return calcSize(type, config, visited);
}

function calcSize(type: ResolvedType, config: PrimitiveSizeConfig, visited: Set<string>): SizeResult | undefined {
  const key = (type.kind === TypeKind.Struct || type.kind === TypeKind.Union || type.kind === TypeKind.Typedef) ? typeKey(type) : undefined;
  if (key && visited.has(key)) {
    return undefined;
  }
  if (key) {
    visited.add(key);
  }

  return handleTypeKind(type, config, visited, key);
}

function handleTypeKind(
  type: ResolvedType,
  config: PrimitiveSizeConfig,
  visited: Set<string>,
  key: string | undefined,
): SizeResult | undefined {
  switch (type.kind) {
    case TypeKind.Void:
      return undefined;

    case TypeKind.Primitive: {
      const custom = type.name ? getCustomTypeSize(type.name, config) : undefined;
      const sz = custom ?? (type.name ? getPrimitiveSize(type.name, config) : undefined);
      return sz !== undefined ? { size: sz, alignment: sz } : undefined;
    }

    case TypeKind.Pointer:
      return { size: getPointerSize(config), alignment: getPointerAlignment(config) };

    case TypeKind.Array: {
      if (!type.elementType) return undefined;
      const elem = calcSize(type.elementType, config, visited);
      if (!elem || type.elementCount === undefined) return undefined;
      return { size: elem.size * type.elementCount, alignment: elem.alignment };
    }

    case TypeKind.Struct:
      return calculateStructSize(type, config, visited);

    case TypeKind.Union:
      return calculateUnionSize(type, config, visited);

    case TypeKind.Enum:
      return { size: getEnumSize(config), alignment: getEnumAlignment(config) };

    case TypeKind.Typedef: {
      if (!type.aliasFor) return undefined;
      const resolved = calcSize(type.aliasFor, config, visited);
      if (!resolved) return undefined;
      if (type.declaredSize !== undefined) {
        resolved.size = type.declaredSize;
      }
      return resolved;
    }

    case TypeKind.Function:
      return { size: getPointerSize(config), alignment: getPointerAlignment(config) };

    case TypeKind.Incomplete:
    case TypeKind.Unknown:
    default:
      return undefined;
  }
}

function calculateStructSize(
  type: ResolvedType,
  config: PrimitiveSizeConfig,
  visited: Set<string>,
): SizeResult | undefined {
  if (!type.members || type.members.length === 0) {
    return undefined; // forward-declared or empty
  }

  let totalSize = 0;
  let maxAlignment = 1;

  // Bit-field packing state
  let bfUnitStart = 0;      // byte offset where current bit-field unit started
  let bfBitsUsed = 0;       // bits consumed in current unit
  let bfUnitBytes = 0;      // size of current unit in bytes
  let bfUnitAlign = 1;      // alignment of current unit
  let bfBaseName = '';      // base type name of current unit

  for (const member of type.members) {
    if (member.bitField) {
      const baseSz = calcSize(member.bitField.baseType, config, visited);
      if (!baseSz) continue;

      const unitBits = baseSz.size * 8;
      const bitWidth = member.bitField.width;
      const baseName = member.bitField.baseType.name ?? '';

      // Determine if we need a new storage unit:
      // - first bit-field in this run
      // - zero-width field (C forces next field to new unit)
      // - different base type
      // - not enough room in current unit
      const needNewUnit =
        bfBitsUsed === 0 ||
        bitWidth === 0 ||
        baseName !== bfBaseName ||
        (bfBitsUsed + bitWidth > unitBits);

      if (needNewUnit) {
        // Finalize current unit's contribution to struct size
        if (bfBitsUsed > 0) {
          totalSize = alignUp(totalSize, bfUnitAlign);
          totalSize = bfUnitStart + bfUnitBytes;
        }

        if (bitWidth === 0) {
          // Zero-width: force next field to new unit, consume no bits,
          // and does NOT contribute to struct alignment (no storage allocated).
          bfBitsUsed = 0;
          bfBaseName = '';
          continue;
        }

        // Start new unit
        const align = type.isPacked ? 1 : baseSz.alignment;
        bfUnitStart = alignUp(totalSize, align);
        bfBitsUsed = 0;
        bfUnitBytes = baseSz.size;
        bfUnitAlign = align;
        bfBaseName = baseName;
      }

      member.offset = bfUnitStart;
      bfBitsUsed += bitWidth;
      if (!type.isPacked && baseSz.alignment > maxAlignment) {
        maxAlignment = baseSz.alignment;
      }
      continue;
    }

    // Non-bit-field member: finalize any open bit-field unit
    if (bfBitsUsed > 0) {
      totalSize = bfUnitStart + bfUnitBytes;
      bfBitsUsed = 0;
      bfBaseName = '';
    }

    const memberResult = calcSize(member.type, config, visited);
    if (!memberResult) continue;

    const align = memberResult.alignment;

    if (!type.isPacked) {
      const padding = alignUp(totalSize, align) - totalSize;
      member.offset = totalSize + padding;
      totalSize += padding;
    } else {
      member.offset = totalSize;
    }

    member.type.size = memberResult.size;
    member.type.alignment = memberResult.alignment;
    totalSize += memberResult.size;
    if (!type.isPacked && align > maxAlignment) {
      maxAlignment = align;
    }
  }

  // Finalize trailing bit-field unit
  if (bfBitsUsed > 0) {
    totalSize = bfUnitStart + bfUnitBytes;
  }

  // Trailing padding to struct alignment
  if (!type.isPacked && maxAlignment > 0) {
    totalSize = alignUp(totalSize, maxAlignment);
  }

  type.size = totalSize;
  type.maxAlignment = maxAlignment;
  type.alignment = maxAlignment;

  return { size: totalSize, alignment: maxAlignment };
}

function calculateUnionSize(
  type: ResolvedType,
  config: PrimitiveSizeConfig,
  visited: Set<string>,
): SizeResult | undefined {
  if (!type.members || type.members.length === 0) {
    return undefined;
  }

  let maxSize = 0;
  let maxAlignment = 1;

  for (const member of type.members) {
    const memberResult = calcSize(member.type, config, visited);
    if (!memberResult) continue;

    member.offset = 0; // All union members start at offset 0
    member.type.size = memberResult.size;
    member.type.alignment = memberResult.alignment;
    if (memberResult.size > maxSize) maxSize = memberResult.size;
    if (memberResult.alignment > maxAlignment) maxAlignment = memberResult.alignment;
  }

  const totalSize = alignUp(maxSize, maxAlignment);
  type.size = totalSize;
  type.maxAlignment = maxAlignment;
  type.alignment = maxAlignment;

  return { size: totalSize, alignment: maxAlignment };
}

function alignUp(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function typeKey(type: ResolvedType): string | undefined {
  if (type.name) return `${type.kind}:${type.name}`;
  return undefined;
}

export function formatBytes(bytes: number): string {
  return bytes === 1 ? '1 byte' : `${bytes} bytes`;
}
