export const meta = { name: 'trivial', description: 'Fixture stage' };

if (args === undefined) return { started: false };

const ANSWER = {
  "answer": 42
};

function greet(name) {
  return `hello ${name}`;
}

const zeta = 'z';

return { started: true, greeting: greet('fixture') };

