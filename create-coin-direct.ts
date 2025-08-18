// create-coin-direct.ts - Use new createCoin API for end-to-end automation
import 'dotenv/config';
import { createCoin, CreateConstants, createMetadataBuilder, createZoraUploaderForCreator, setApiKey } from "@zoralabs/coins-sdk";
import { Address, Hex, createWalletClient, createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import fs from 'node:fs/promises';

// Enhanced Node.js File polyfill that works with FormData
import { Blob } from 'node:buffer';

class NodeFile extends Blob {
  public name: string;
  public lastModified: number;

  constructor(
    fileBits: BlobPart[],
    fileName: string,
    options?: { type?: string; lastModified?: number }
  ) {
    super(fileBits, { type: options?.type });
    this.name = fileName;
    this.lastModified = options?.lastModified || Date.now();
  }

  get [Symbol.toStringTag]() {
    return 'File';
  }
}

// Set global File to our enhanced polyfill
global.File = NodeFile as any;

async function main() {
  const ZORA_API_KEY = process.env.ZORA_API_KEY!;
  const PRIVATE_KEY = process.env.PRIVY_PRIVATE_KEY as Hex;
  const SMART_WALLET_ADDRESS = process.env.ZORA_SMART_WALLET_ADDRESS as Address;

  console.log('🚀 Creating Content Coin with new Zora SDK API...');
  console.log('Smart Wallet Address:', SMART_WALLET_ADDRESS);

  // Set the Zora API key for metadata operations
  setApiKey(ZORA_API_KEY);

  // Create EOA account from private key
  const account = privateKeyToAccount(PRIVATE_KEY);
  console.log('EOA Address:', account.address);

  // Set up viem clients with EOA account
  const publicClient = createPublicClient({
    chain: base,
    transport: http("https://mainnet.base.org"),
  });

  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http("https://mainnet.base.org"),
  });

  try {
    console.log('📸 Testing with local podcast-cover.png file...');

    // Use local podcast cover image
    const imageBuffer = await fs.readFile('./podcast-cover.png');
    const testDescription = "Test post using local podcast cover image";
    
    console.log('🔗 Uploading metadata with local podcast cover...');
    console.log('- Image file: podcast-cover.png');
    console.log('- Description:', testDescription);
    console.log('- File size:', imageBuffer.length, 'bytes');

    // Create File object from buffer
    const imageFile = new NodeFile([imageBuffer], 'podcast-cover.png', { type: 'image/png' });

    // Use createMetadataBuilder with withImage (local file)
    const { createMetadataParameters } = await createMetadataBuilder()
      .withName("TokenMetrics Test #" + Date.now().toString().slice(-4))
      .withSymbol("TM" + Date.now().toString().slice(-4))
      .withDescription(testDescription)
      .withImage(imageFile) // Use local image file
      .upload(createZoraUploaderForCreator(SMART_WALLET_ADDRESS));

    console.log('✅ Metadata uploaded successfully with podcast cover');

    console.log('🪙 Creating Content Coin with direct execution...');

    // Use new createCoin API for direct execution
    const args = {
      creator: SMART_WALLET_ADDRESS, // Smart Wallet as creator
      ...createMetadataParameters, // Spreads name, symbol, metadata
      currency: CreateConstants.ContentCoinCurrencies.ZORA,
      chainId: base.id,
      startingMarketCap: CreateConstants.StartingMarketCaps.LOW,
      // platformReferrer: optional
    };

    console.log('📤 Executing coin creation transaction...');
    
    // Direct coin creation with transaction execution
    const result = await createCoin({
      call: args,
      walletClient,
      publicClient,
      options: {
        // account: account, // Override if needed
        // skipValidateTransaction: false, // Validate by default
      },
    });

    console.log('🎉 SUCCESS! Content Coin created automatically!');
    console.log('================================');
    console.log('Transaction hash:', result.hash);
    console.log('Coin address:', result.address);
    console.log('Creator:', SMART_WALLET_ADDRESS);
    console.log('Deployment details:', result.deployment);
    
    console.log('\\n✅ FULLY AUTOMATED - NO MANUAL STEPS NEEDED!');
    console.log('- Metadata uploaded to IPFS');
    console.log('- Content Coin deployed on Base');
    console.log('- Transaction confirmed on-chain');
    console.log('- Ready for trading on Zora marketplace');

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.error('Full error:', error);
  }
}

main().catch(console.error);