import net from 'net';

const client = new net.Socket();
let buffer = '';
let phase = 0;

client.connect(8080, '127.0.0.1', () => {
  console.log('Connected to server!');
});

client.on('data', (data) => {
  const text = data.toString('utf-8');
  process.stdout.write(text);
  buffer += text;

  // Give Output some time to finish coming over the wire, then act based on phase
  setTimeout(() => {
    if (phase === 0 && buffer.includes('1. Airport')) {
      phase = 1;
      buffer = '';
      console.log('\n--- Sending: 1 ---');
      client.write('1\n');
    } else if (phase === 1 && buffer.includes('Mode? [hard] / easy:')) {
      phase = 2;
      buffer = '';
      console.log('\n--- Sending: hard ---');
      client.write('hard\n');
    } else if (phase === 2 && buffer.includes('>')) {
      phase = 3;
      buffer = '';
      console.log('\n--- Sending: inventory ---');
      client.write('inventory\n');
    } else if (phase === 3 && buffer.includes('>')) {
      console.log('\n--- SUCCESS! Final response received ---');
      client.end();
    }
  }, 500);
});

client.on('close', () => {
  console.log('\nConnection closed');
});
