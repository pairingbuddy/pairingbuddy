export const meta = {
  name: "date_now_nested",
  description: "Fixture for nondeterminism guards",
};

function outer() {
  const inner = () => Date.now();
  return inner();
}
return outer();
