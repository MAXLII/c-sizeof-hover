// SPDX-License-Identifier: MIT
/**
 * @file    types.ts
 * @brief   Core type definitions for the C type system.
 * @details
 *          This file is part of the c-sizeof-hover project.
 *
 *          Module responsibilities:
 *          - Define ResolvedType, TypeKind, StructMember, and related interfaces
 *          - Serve as the foundation that every other module depends on
 *
 *          Design notes:
 *          - All size fields are in bytes
 *          - Alignment follows natural ARM EABI rules (1/2/4/8)
 *          - undefined size means "incomplete" (e.g. forward-declared struct, void)
 *
 * @author  Max.Li
 * @date    2026-05-09
 * @version 1.0.0
 *
 * Copyright (c) 2026 Max.Li.
 * All rights reserved.
 *
 * This file is licensed under the MIT License.
 * See the LICENSE file in the project root for full license text.
 */

export enum TypeKind {
  Primitive = 'primitive',
  Pointer = 'pointer',
  Array = 'array',
  Struct = 'struct',
  Union = 'union',
  Enum = 'enum',
  Typedef = 'typedef',
  Function = 'function',
  Void = 'void',
  Incomplete = 'incomplete',
  Unknown = 'unknown',
}

export type Qualifier = 'const' | 'volatile' | 'restrict';

export interface ResolvedType {
  kind: TypeKind;
  name?: string;
  size?: number;
  declaredSize?: number;
  alignment?: number;
  qualifiers?: Set<Qualifier>;

  // Pointer
  pointeeType?: ResolvedType;

  // Array
  elementType?: ResolvedType;
  elementCount?: number;

  // Struct / Union
  members?: StructMember[];
  maxAlignment?: number;
  isPacked?: boolean;

  // Enum
  enumerators?: Enumerator[];
  underlyingType?: ResolvedType;

  // Typedef
  aliasFor?: ResolvedType;

  // Function
  returnType?: ResolvedType;
  parameters?: ResolvedType[];
  isVariadic?: boolean;
}

export interface StructMember {
  name: string;
  type: ResolvedType;
  offset: number;
  bitField?: { width: number; baseType: ResolvedType };
}

export interface Enumerator {
  name: string;
  value?: number;
}

export enum SymbolKind {
  Variable = 'variable',
  Typedef = 'typedef',
  StructTag = 'structTag',
  UnionTag = 'unionTag',
  EnumTag = 'enumTag',
  Function = 'function',
  EnumConstant = 'enumConstant',
  Field = 'field',
}

export interface SymbolEntry {
  name: string;
  kind: SymbolKind;
  type: ResolvedType;
  sourceRow: number;
  sourceColumn: number;
}

export interface Scope {
  symbols: Map<string, SymbolEntry>;
  parent: Scope | null;
}

export interface DocumentSymbolTable {
  globalScope: Scope;
  builtinTypes: Map<string, ResolvedType>;
  structDefinitions: Map<string, ResolvedType>;
  unionDefinitions: Map<string, ResolvedType>;
  typedefs: Map<string, ResolvedType>;
}

export interface CachedDocument {
  uri: string;
  version: number;
  tree: unknown;
  symbolTable: DocumentSymbolTable;
  lastParseTime: number;
}
