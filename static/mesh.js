export function miteredCellSpan(start, end, thicknessPosition, profileStart, profileEnd) {
  return [
    Math.max(start, profileStart + thicknessPosition),
    Math.min(end, profileEnd - thicknessPosition),
  ];
}
