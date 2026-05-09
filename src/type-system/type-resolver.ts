// SPDX-License-Identifier: MIT
/**
 * @file    type-resolver.ts
 * @brief   Follow typedef chains and resolve types from symbol table.
 * @details
 *          This file is part of the c-sizeof-hover project.
 *
 *          Module responsibilities:
 *          - Resolve a type through typedef aliases to its concrete form
 *          - Detect and handle circular typedef references
 *          - Look up types from the document symbol table
 *          - Locate identifier declaration context in AST
 *
 *          Design notes:
 *          - Max resolution depth: 32 (prevents stack overflow on circular refs)
 *          - Resolution respects scoping: local -> function -> global
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

import {
  ResolvedType,
  TypeKind,
  DocumentSymbolTable,
  SymbolKind,
} from './types';
import { PrimitiveSizeConfig } from './primitive-sizes';

const MAX_RESOLVE_DEPTH = 32;

/**
 * Resolve a type through typedef chains to its concrete form.
 * Returns the final concrete type (no Typedef kind).
 */
export function resolveThroughTypedefs(
  type: ResolvedType,
  depth: number = 0,
): ResolvedType {
  if (depth > MAX_RESOLVE_DEPTH) {
    return { kind: TypeKind.Incomplete, name: `(max depth: ${type.name || 'unknown'})` };
  }

  if (type.kind !== TypeKind.Typedef) {
    return type;
  }

  if (!type.aliasFor) {
    return { kind: TypeKind.Incomplete, name: type.name };
  }

  return resolveThroughTypedefs(type.aliasFor, depth + 1);
}

/**
 * Look up a variable name in the symbol table, respecting scope.
 * Searches from currentScope up through parent scopes.
 */
export function lookupVariable(
  name: string,
  symbolTable: DocumentSymbolTable,
  scope: { row: number; column: number },
): ResolvedType | null {
  // Search nested scopes (function local) — for now, search global
  // TODO: scope-aware lookup based on row/column

  // Check global scope
  const entry = symbolTable.globalScope.symbols.get(name);
  if (entry && entry.kind === SymbolKind.Variable) {
    return entry.type;
  }

  // Check enum constants
  const enumEntry = symbolTable.globalScope.symbols.get(name);
  if (enumEntry && enumEntry.kind === SymbolKind.EnumConstant) {
    return enumEntry.type;
  }

  // Check struct/union tags
  const structDef = symbolTable.structDefinitions.get(name);
  if (structDef) return structDef;

  const unionDef = symbolTable.unionDefinitions.get(name);
  if (unionDef) return unionDef;

  // Check typedefs
  const td = symbolTable.typedefs.get(name);
  if (td) return td;

  // Check builtin types
  const builtin = symbolTable.builtinTypes.get(name);
  if (builtin) return builtin;

  return null;
}

/**
 * Resolve a type identifier name through the symbol table.
 */
export function resolveTypeName(
  name: string,
  symbolTable: DocumentSymbolTable,
): ResolvedType | null {
  // Check builtin first
  const builtin = symbolTable.builtinTypes.get(name);
  if (builtin) return builtin;

  // Check typedefs
  const td = symbolTable.typedefs.get(name);
  if (td) return td;

  // Check struct tags
  const structDef = symbolTable.structDefinitions.get(name);
  if (structDef) return structDef;

  // Check union tags
  const unionDef = symbolTable.unionDefinitions.get(name);
  if (unionDef) return unionDef;

  // Check global symbols (variables, enum tags)
  const sym = symbolTable.globalScope.symbols.get(name);
  if (sym) return sym.type;

  return null;
}

/**
 * Format a ResolvedType into a human-readable C type string.
 */
export function formatTypeName(type: ResolvedType): string {
  const resolved = resolveThroughTypedefs(type);

  switch (resolved.kind) {
    case TypeKind.Primitive:
      return resolved.name || 'unknown';

    case TypeKind.Pointer:
      if (resolved.pointeeType) {
        return formatTypeName(resolved.pointeeType) + '*';
      }
      return 'void*';

    case TypeKind.Array:
      if (resolved.elementType) {
        const elemName = formatTypeName(resolved.elementType);
        const count = resolved.elementCount !== undefined
          ? String(resolved.elementCount)
          : '';
        return `${elemName}[${count}]`;
      }
      return 'unknown[]';

    case TypeKind.Struct:
      return `struct ${resolved.name || '(anonymous)'}`;

    case TypeKind.Union:
      return `union ${resolved.name || '(anonymous)'}`;

    case TypeKind.Enum:
      return `enum ${resolved.name || '(anonymous)'}`;

    case TypeKind.Typedef:
      return resolved.name || 'typedef';

    case TypeKind.Function:
      return `${resolved.returnType ? formatTypeName(resolved.returnType) : 'void'}(${resolved.name || ''})(...)`;

    case TypeKind.Void:
      return 'void';

    case TypeKind.Incomplete:
      return `(incomplete: ${resolved.name || ''})`;

    default:
      return resolved.name || '(unknown)';
  }
}

/**
 * Format a struct/union member layout as a text table.
 * Recursively displays nested struct/union members.
 */
export function formatStructLayout(type: ResolvedType, baseOffset: number = 0, indent: string = ''): string {
  if (!type.members || type.members.length === 0) {
    return '(empty)';
  }

  const lines: string[] = [];
  const kind = type.kind === TypeKind.Union ? 'union' : 'struct';
  const totalSize = type.size ?? 0;

  // Only show the header for the outermost type
  if (indent === '') {
    lines.push(`${kind} ${type.name || '(anonymous)'} {`);
  }

  for (const member of type.members) {
    const absOffset = baseOffset + member.offset;
    let line = `${indent}  offset ${String(absOffset).padStart(3)}: `;
    const typeName = formatTypeName(member.type);

    if (member.bitField) {
      line += `${typeName} ${member.name}:${member.bitField.width}`;
    } else {
      line += `${typeName} ${member.name}`;
    }

    // Check if this member is a struct/union with its own members to expand
    const resolved = resolveThroughTypedefs(member.type);
    const hasNestedMembers = (resolved.kind === TypeKind.Struct || resolved.kind === TypeKind.Union)
      && resolved.members && resolved.members.length > 0;

    if (hasNestedMembers) {
      if (member.type.size !== undefined) {
        line += ` {`;
      }
      lines.push(line);

      // Recursively format nested members
      if (resolved.members) {
        const nestedLayout = formatStructLayout(resolved, absOffset, indent + '  ');
        if (nestedLayout !== '(empty)') {
          lines.push(nestedLayout);
        }
      }

      if (member.type.size !== undefined) {
        lines.push(`${indent}  }  (${member.type.size} bytes)`);
      }
    } else {
      if (member.type.size !== undefined) {
        line += `  (${member.type.size} bytes)`;
      }
      lines.push(line);
    }
  }

  if (indent === '') {
    const alignment = type.alignment ?? 1;
    lines.push(`}`);
    lines.push(`// total: ${totalSize} bytes, alignment: ${alignment}`);
  }

  return lines.join('\n');
}
