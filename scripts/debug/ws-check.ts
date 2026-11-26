import { Connection } from "@solana/web3.js";
for (const [n, http, ws] of [["er","https://devnet-as.magicblock.app","wss://devnet-as.magicblock.app"],["base","https://rpc.magicblock.app/devnet","wss://rpc.magicblock.app/devnet"]]) {
  const c = new Connection(http, { wsEndpoint: ws });
  let k = 0; c.onSlotChange(() => { k++; });
  setTimeout(() => console.log(n, "slot events in 6s:", k), 6000);
}
setTimeout(() => process.exit(0), 6500);
