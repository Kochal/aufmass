/**
 * Safe arithmetic expression evaluator for Menge input.
 *
 * Supports: `+ - * /`, parentheses, integer and decimal numbers (`.` or `,`
 * as separator). No eval / new Function — explicit recursive-descent parser.
 *
 * Grammar:
 *   expr   = term   (( '+' | '-' ) term)*
 *   term   = factor (( '*' | '/' ) factor)*
 *   factor = NUMBER | '(' expr ')' | '-' factor
 */

export interface CalcResult {
  value: number | null;  // null when input is empty or invalid
  error: string | null;  // German error message when invalid
}

// ── Tokenizer ──────────────────────────────────────────────────────────────

type TokenKind = "num" | "+" | "-" | "*" | "/" | "(" | ")" | "eof";

interface Token {
  kind: TokenKind;
  value?: number; // only for kind === "num"
}

function tokenize(raw: string): Token[] | string {
  // Normalise German decimal comma to dot
  const s = raw.replace(/,/g, ".").trim();
  const tokens: Token[] = [];
  let i = 0;

  while (i < s.length) {
    const c = s[i];

    if (/\s/.test(c)) { i++; continue; }

    if (/[0-9.]/.test(c)) {
      let num = "";
      let dots = 0;
      while (i < s.length && /[0-9.]/.test(s[i])) {
        if (s[i] === ".") dots++;
        num += s[i++];
      }
      if (dots > 1) return "Ungültige Zahl (mehrere Dezimalpunkte)";
      tokens.push({ kind: "num", value: parseFloat(num) });
      continue;
    }

    if (c === "+" || c === "-" || c === "*" || c === "/" || c === "(" || c === ")") {
      tokens.push({ kind: c as TokenKind });
      i++;
      continue;
    }

    return `Unbekanntes Zeichen: „${c}"`;
  }

  tokens.push({ kind: "eof" });
  return tokens;
}

// ── Parser ─────────────────────────────────────────────────────────────────

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private consume(): Token {
    return this.tokens[this.pos++];
  }

  private expect(kind: TokenKind): void {
    const t = this.consume();
    if (t.kind !== kind) throw new Error(`Erwartet „${kind}", gefunden „${t.kind}"`);
  }

  parseExpr(): number {
    let left = this.parseTerm();
    while (this.peek().kind === "+" || this.peek().kind === "-") {
      const op = this.consume().kind;
      const right = this.parseTerm();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  private parseTerm(): number {
    let left = this.parseFactor();
    while (this.peek().kind === "*" || this.peek().kind === "/") {
      const op = this.consume().kind;
      const right = this.parseFactor();
      if (op === "/" && right === 0) throw new Error("Division durch Null");
      left = op === "*" ? left * right : left / right;
    }
    return left;
  }

  private parseFactor(): number {
    const t = this.peek();

    if (t.kind === "-") {
      this.consume();
      return -this.parseFactor();
    }

    if (t.kind === "(") {
      this.consume();
      const val = this.parseExpr();
      this.expect(")");
      return val;
    }

    if (t.kind === "num") {
      this.consume();
      return t.value!;
    }

    throw new Error(`Unerwartetes Token: „${t.kind}"`);
  }

  atEnd(): boolean {
    return this.peek().kind === "eof";
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/** Round to n decimal places using ROUND_HALF_UP (same as Python Decimal default). */
function round(n: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((n + Number.EPSILON) * factor) / factor;
}

/**
 * Evaluate an arithmetic expression string.
 *
 * Returns `{ value: null, error: null }` for empty/whitespace input.
 * Returns `{ value: number, error: null }` for a valid expression.
 * Returns `{ value: null, error: "…" }` for invalid input.
 */
export function evaluateExpression(input: string): CalcResult {
  const trimmed = input.trim();
  if (!trimmed) return { value: null, error: null };

  const tokens = tokenize(trimmed);
  if (typeof tokens === "string") return { value: null, error: tokens };

  try {
    const parser = new Parser(tokens);
    const result = parser.parseExpr();
    if (!parser.atEnd()) return { value: null, error: "Unvollständiger Ausdruck" };
    if (!isFinite(result)) return { value: null, error: "Ergebnis nicht darstellbar" };
    return { value: round(result, 3), error: null };
  } catch (e) {
    return { value: null, error: e instanceof Error ? e.message : "Ungültiger Ausdruck" };
  }
}

/**
 * True when the input string is an expression (contains an operator outside of
 * a plain number). Used to decide whether to show the preview and persist the formula.
 */
export function isExpression(input: string): boolean {
  // Strip leading minus (negative numbers are plain numbers)
  const s = input.trimStart().replace(/^-/, "");
  return /[+\-*/()]/.test(s);
}
