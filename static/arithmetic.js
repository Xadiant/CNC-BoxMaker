export function evaluateArithmetic(expression) {
  const source = String(expression).trim();
  if (!source) throw new Error("Enter a value");

  let position = 0;

  function skipWhitespace() {
    while (/\s/.test(source[position] ?? "")) position += 1;
  }

  function parseNumber() {
    skipWhitespace();
    const match = source.slice(position).match(/^(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?/);
    if (!match) throw new Error(`Expected a number at position ${position + 1}`);
    position += match[0].length;
    return Number(match[0]);
  }

  function parsePrimary() {
    skipWhitespace();
    if (source[position] !== "(") return parseNumber();
    position += 1;
    const value = parseAddSubtract();
    skipWhitespace();
    if (source[position] !== ")") throw new Error(`Expected “)” at position ${position + 1}`);
    position += 1;
    return value;
  }

  function parseUnary() {
    skipWhitespace();
    if (source[position] === "+") {
      position += 1;
      return parseUnary();
    }
    if (source[position] === "-") {
      position += 1;
      return -parseUnary();
    }
    return parsePrimary();
  }

  function parseMultiplyDivide() {
    let value = parseUnary();
    while (true) {
      skipWhitespace();
      const operator = source[position];
      if (operator !== "*" && operator !== "/") return value;
      position += 1;
      const right = parseUnary();
      value = operator === "*" ? value * right : value / right;
    }
  }

  function parseAddSubtract() {
    let value = parseMultiplyDivide();
    while (true) {
      skipWhitespace();
      const operator = source[position];
      if (operator !== "+" && operator !== "-") return value;
      position += 1;
      const right = parseMultiplyDivide();
      value = operator === "+" ? value + right : value - right;
    }
  }

  const value = parseAddSubtract();
  skipWhitespace();
  if (position !== source.length) throw new Error(`Unexpected “${source[position]}” at position ${position + 1}`);
  if (!Number.isFinite(value)) throw new Error("Expression must produce a finite number");
  return value;
}
