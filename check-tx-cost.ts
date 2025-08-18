// check-tx-cost.ts - Check the cost of the successful Zora posting transaction
import 'dotenv/config';
import { createPublicClient, http, formatEther } from "viem";
import { base } from "viem/chains";

async function main() {
  const publicClient = createPublicClient({
    chain: base,
    transport: http("https://mainnet.base.org"),
  });

  const txHash = "0x52f56fd9a7d26950934ce6465d74292ce66f28ec724ca061b745feb67473aa0a";
  
  console.log('🔍 Analyzing transaction cost for Zora posting...');
  console.log('Transaction Hash:', txHash);

  try {
    const receipt = await publicClient.getTransactionReceipt({
      hash: txHash as `0x${string}`,
    });

    const tx = await publicClient.getTransaction({
      hash: txHash as `0x${string}`,
    });

    const gasUsed = receipt.gasUsed;
    const gasPrice = tx.gasPrice || tx.maxFeePerGas || 0n;
    const totalCost = gasUsed * gasPrice;

    console.log('\n💰 ZORA CONTENT COIN CREATION COST:');
    console.log('===================================');
    console.log('Gas Used:', gasUsed.toLocaleString(), 'units');
    console.log('Gas Price:', formatEther(gasPrice), 'ETH per gas unit');
    console.log('Total Cost:', formatEther(totalCost), 'ETH');
    
    // Convert to USD (approximate ETH price)
    const ethPriceUSD = 3400; // Approximate ETH price
    const costUSD = parseFloat(formatEther(totalCost)) * ethPriceUSD;
    console.log('Cost in USD:', '$' + costUSD.toFixed(4));

    console.log('\n📊 COST BREAKDOWN:');
    console.log('- Per posting cost: $' + costUSD.toFixed(4));
    console.log('- Daily cost (1 post): $' + costUSD.toFixed(4));
    console.log('- Weekly cost (7 posts): $' + (costUSD * 7).toFixed(2));
    console.log('- Monthly cost (30 posts): $' + (costUSD * 30).toFixed(2));
    console.log('- Yearly cost (365 posts): $' + (costUSD * 365).toFixed(2));

    console.log('\n✅ Very affordable for automated daily posting!');
    
    return {
      gasUsed,
      totalCostETH: formatEther(totalCost),
      costUSD: costUSD.toFixed(4)
    };

  } catch (error: any) {
    console.error('❌ Error analyzing transaction:', error.message);
    console.error('Make sure the transaction hash is correct and the transaction exists on Base network');
  }
}

main().catch(console.error);