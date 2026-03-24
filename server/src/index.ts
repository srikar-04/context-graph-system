const unusedVar = 123;

const payload = { source: "husky-test", count: 1 };
console.log("payload", payload);

function badlyFormatted(a: number, b: number) {
  return a + b;
}

const count = "not-a-number";

function willThrow(obj?: { name: string }) {
  return obj!.name.toUpperCase();
}

export { badlyFormatted, willThrow };
