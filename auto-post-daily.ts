// auto-post-daily.ts - Automated daily Zora posting from @tokenmetricsinc Twitter
import 'dotenv/config';
import { TwitterApi } from 'twitter-api-v2';
import { createCoin, CreateConstants, setApiKey, createMetadataBuilder, createZoraUploaderForCreator } from "@zoralabs/coins-sdk";
import { Address, Hex, createWalletClient, createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import fs from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import OpenAI from 'openai';

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

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

interface TwitterPost {
  id: string;
  text: string;
  created_at: string;
  conversation_id: string;
  referenced_tweets?: Array<{
    type: string;
    id: string;
  }>;
  attachments?: {
    media_keys?: string[];
  };
  public_metrics: {
    retweet_count: number;
    reply_count: number;
    like_count: number;
    quote_count: number;
  };
}

interface TwitterMedia {
  media_key: string;
  type: string;
  url?: string;
  preview_image_url?: string;
}

// Thread detection and processing functions
function isPartOfThread(tweet: TwitterPost): boolean {
  // Check if it has referenced_tweets with type "replied_to"
  const hasRepliedTo = tweet.referenced_tweets?.some(ref => ref.type === "replied_to");
  
  // Check if conversation_id differs from tweet ID (means it's a reply)
  const isReply = tweet.conversation_id !== tweet.id;
  
  return hasRepliedTo || isReply;
}

// Get thread tweets from the already fetched timeline data
function getThreadFromTimeline(conversationId: string, timelineData: TwitterPost[]): TwitterPost[] {
  return timelineData.filter(tweet => tweet.conversation_id === conversationId);
}

function findFirstTweet(tweets: TwitterPost[]): TwitterPost | undefined {
  return tweets.find(tweet => 
    !tweet.referenced_tweets?.some(ref => ref.type === "replied_to")
  );
}

function sortThreadChronologically(tweets: TwitterPost[]): TwitterPost[] {
  return tweets.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

async function summarizeThread(tweets: TwitterPost[]): Promise<string> {
  const threadText = tweets.map((tweet, index) => 
    `${index + 1}. ${tweet.text}`
  ).join('\n');

  try {
    const response = await openai.responses.create({
      model: 'gpt-4.1',
      input: `Please summarize this Twitter thread for social media posting:\n\n${threadText}`,
      instructions: `You are a social media content specialist. Summarize this Twitter thread following these guidelines:
      
      1. Remove any t.co shortened links (they start with https://t.co/)
      2. Remove any hashtags (#) - strip them completely
      3. Capture the main points and key insights from the thread
      4. Maintain any important numbers, percentages, or metrics
      5. Keep cryptocurrency symbols (like $ETH, $BTC, $TMAI, etc.)
      6. Make the summary clear and engaging for social media
      7. Keep under 250 characters for optimal readability
      8. Don't add emojis unless they were in the original
      9. Focus on the main value proposition or key insight
      10. Create a cohesive summary that flows well
      11. Remove any incomplete sentences
      12. Remove any links or URLs completely
      
      Return only the cleaned, summarized content - no quotes, no explanations.`,
      max_output_tokens: 150
    });

    return response.output_text || '';
  } catch (error: any) {
    console.error('OpenAI API error:', error);
    // Fallback: use first tweet's text with basic cleanup
    return cleanTextBasic(tweets[0]?.text || '');
  }
}

// Unified AI content cleaning function for both single tweets and threads
async function cleanAndOptimizeContent(content: string, isThread: boolean = false): Promise<string> {
  const contentType = isThread ? 'Twitter thread summary' : 'tweet content';
  const action = isThread ? 'summarized thread' : 'original tweet';
  
  try {
    const response = await openai.responses.create({
      model: 'gpt-4.1',
      input: `Please clean and optimize this ${contentType} for social media posting:\n\n${content}`,
      instructions: `You are a social media content specialist. Clean and optimize the given ${contentType} following these guidelines:
      
      1. Remove any t.co shortened links (they start with https://t.co/)
      2. Remove any hashtags (#) - strip them completely
      3. Keep the core message and key information intact
      4. Maintain any important numbers, percentages, or metrics  
      5. Keep cryptocurrency symbols (like $ETH, $BTC, $TMAI, etc.)
      6. Make the text clear and engaging for social media
      7. Keep under 250 characters for optimal readability
      8. Don't add emojis unless they were in the original
      9. If text appears truncated, work with what's available
      10. Focus on the main value proposition or key insight
      11. Remove any incomplete sentences at the end
      12. Remove any links or URLs completely
      13. ${isThread ? 'Ensure the summary captures the main thread points' : 'Preserve the original message intent'}
      
      Return only the cleaned, optimized content - no quotes, no explanations.`,
      max_output_tokens: 150
    });

    return response.output_text || content;
  } catch (error: any) {
    console.error('OpenAI API error:', error);
    // Fallback: basic cleanup
    return cleanTextBasic(content);
  }
}

// Basic text cleanup fallback function
function cleanTextBasic(text: string): string {
  return text
    .replace(/https:\/\/t\.co\/\w+/g, '') // Remove t.co links
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

async function processTwitterContent(tweet: TwitterPost, timelineData: TwitterPost[]): Promise<{ content: string, firstTweetId: string }> {
  try {
    console.log('🧵 Checking if tweet is part of a thread...');
    
    if (!isPartOfThread(tweet)) {
      console.log('📝 Single tweet detected - applying AI cleaning and optimization');
      const cleanedContent = await cleanAndOptimizeContent(tweet.text, false);
      console.log('✨ Content cleaned and optimized by AI');
      return {
        content: cleanedContent,
        firstTweetId: tweet.id
      };
    }

    console.log('🧵 Thread detected, extracting thread from timeline data...');
    
    try {
      const threadTweets = getThreadFromTimeline(tweet.conversation_id, timelineData);
      
      if (threadTweets.length <= 1) {
        console.log('📝 Only one tweet in thread found in timeline, using original content');
        const cleanedContent = await cleanAndOptimizeContent(tweet.text, false);
        return {
          content: cleanedContent,
          firstTweetId: tweet.id
        };
      }

      const sortedTweets = sortThreadChronologically(threadTweets);
      const firstTweet = findFirstTweet(threadTweets);
      
      console.log(`🧵 Found ${sortedTweets.length} tweets in thread, summarizing...`);
      const summary = await summarizeThread(sortedTweets);
      
      // Apply additional AI cleaning to the thread summary
      console.log('✨ Applying final AI optimization to thread summary...');
      const cleanedSummary = await cleanAndOptimizeContent(summary, true);
      
      return {
        content: cleanedSummary,
        firstTweetId: firstTweet?.id || tweet.conversation_id
      };
      
    } catch (error: any) {
      console.warn('⚠️ Failed to process thread, using original tweet:', error.message);
      const cleanedContent = await cleanAndOptimizeContent(tweet.text, false);
      return {
        content: cleanedContent,
        firstTweetId: tweet.conversation_id
      };
    }

  } catch (error: any) {
    console.error('❌ Error processing Twitter content:', error);
    return {
      content: tweet.text,
      firstTweetId: tweet.id
    };
  }
}

// Deduplication system
const POSTED_TWEETS_FILE = 'posted-tweets.json';

interface PostedTweetRecord {
  tweetId: string;
  coinName: string;
  zoraTransaction: string;
  postedAt: string;
}

async function loadPostedTweets(): Promise<Set<string>> {
  try {
    const data = await fs.readFile(POSTED_TWEETS_FILE, 'utf8');
    const records: PostedTweetRecord[] = JSON.parse(data);
    return new Set(records.map(record => record.tweetId));
  } catch (error) {
    // File doesn't exist yet, return empty set
    return new Set();
  }
}

async function savePostedTweet(record: PostedTweetRecord): Promise<void> {
  try {
    let records: PostedTweetRecord[] = [];
    
    // Load existing records
    try {
      const data = await fs.readFile(POSTED_TWEETS_FILE, 'utf8');
      records = JSON.parse(data);
    } catch (error) {
      // File doesn't exist, start with empty array
    }
    
    // Add new record
    records.push(record);
    
    // Keep only the last 1000 records to prevent the file from growing too large
    if (records.length > 1000) {
      records = records.slice(-1000);
    }
    
    // Save back to file
    await fs.writeFile(POSTED_TWEETS_FILE, JSON.stringify(records, null, 2));
    console.log('✅ Tweet ID saved to deduplication file');
    
  } catch (error: any) {
    console.error('⚠️  Failed to save posted tweet record:', error.message);
    // Don't throw - this shouldn't break the main flow
  }
}

async function getLatestImagePost(alreadyPosted: Set<string>): Promise<{ post: TwitterPost, imageUrl: string, timelineData: TwitterPost[] }> {
  console.log('🐦 Fetching latest post from @tokenmetricsinc...');
  console.log('💡 Optimized for minimal API usage');
  
  const twitterClient = new TwitterApi({
    appKey: process.env.TWITTER_API_KEY!,
    appSecret: process.env.TWITTER_API_SECRET!,
    accessToken: process.env.TWITTER_ACCESS_TOKEN!,
    accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET!,
  });

  try {
    // Use known user ID to save 1 API call (from: 1136430327176581120)
    const userId = '1136430327176581120'; // @tokenmetricsinc
    console.log('✅ Using cached user ID for @tokenmetricsinc');

    // Get recent tweets with media - fetch 20 to capture potential thread content
    console.log('📡 Making single API call for tweets (max 20)...');
    const tweets = await twitterClient.v2.userTimeline(userId, {
      max_results: 20, // Increased to capture thread content in single call
      'tweet.fields': ['created_at', 'public_metrics', 'attachments', 'referenced_tweets', 'conversation_id'],
      'media.fields': ['type', 'url', 'preview_image_url', 'width', 'height'],
      expansions: ['attachments.media_keys'],
      exclude: ['retweets'] // Only exclude retweets, we'll filter replies manually
    });

    // Access the actual tweet data from the paginator
    const tweetData = tweets._realData?.data || [];
    const mediaData = tweets._realData?.includes?.media || [];

    if (!tweetData || tweetData.length === 0) {
      throw new Error('No tweets found');
    }

    console.log(`📊 Analyzing ${tweetData.length} recent tweets...`);
    console.log(`🔍 Already posted: ${alreadyPosted.size} tweets tracked`);
    console.log(`📷 Available media attachments: ${mediaData.length}`);

    // Find the latest tweet with image(s), excluding reposts, replies, videos, and already posted
    for (const tweet of tweetData) {
      console.log(`🔍 Checking tweet ${tweet.id}...`);
      
      // Skip already posted tweets
      if (alreadyPosted.has(tweet.id)) {
        console.log('  ❌ Already posted to Zora - skipping');
        continue;
      }
      
      // Skip replies to OTHER users (but allow self-replies which are threads)
      if (tweet.text.startsWith('@')) {
        // Check if it's replying to someone else (not a self-thread)
        const replyMatch = tweet.text.match(/^@(\w+)/);
        if (replyMatch && replyMatch[1] !== 'tokenmetricsinc') {
          console.log('  ❌ Skipping reply to other user');
          continue;
        }
      }

      // Skip retweets (tweets that start with RT or have referenced_tweets of type 'retweeted')
      if (tweet.text.startsWith('RT @') || 
          (tweet.referenced_tweets && tweet.referenced_tweets.some(ref => ref.type === 'retweeted'))) {
        console.log('  ❌ Skipping retweet');
        continue;
      }

      // Skip quote tweets
      if (tweet.referenced_tweets && tweet.referenced_tweets.some(ref => ref.type === 'quoted')) {
        console.log('  ❌ Skipping quote tweet');
        continue;
      }

      // Check if tweet has media attachments
      if (!tweet.attachments?.media_keys) {
        console.log('  ❌ No media attachments');
        continue;
      }

      const tweetMedia = mediaData.filter(media => 
        tweet.attachments!.media_keys!.includes(media.media_key)
      );

      // Skip if contains video
      const hasVideo = tweetMedia.some(media => 
        media.type === 'video' || media.type === 'animated_gif'
      );
      if (hasVideo) {
        console.log('  ❌ Contains video/gif, skipping');
        continue;
      }

      // Find image media
      const imageMedia = tweetMedia.find(media => media.type === 'photo');
      if (!imageMedia?.url) {
        console.log('  ❌ No photo media found');
        continue;
      }

      console.log('✅ Found valid image post:');
      console.log('- Post ID:', tweet.id);
      console.log('- Created:', tweet.created_at);
      console.log('- Text:', tweet.text.substring(0, 100) + (tweet.text.length > 100 ? '...' : ''));
      console.log('- Image URL:', imageMedia.url);
      console.log('- Media type:', imageMedia.type);
      
      return {
        post: tweet as TwitterPost,
        imageUrl: imageMedia.url,
        timelineData: tweetData as TwitterPost[]
      };
    }

    throw new Error('No valid image posts found in recent tweets (all filtered: reposts/retweets/videos/already posted)');

  } catch (error: any) {
    console.error('❌ Twitter API Error:', error.message);
    
    // Check for rate limit error specifically
    if (error.code === 429) {
      const resetTime = error.rateLimit?.reset;
      if (resetTime) {
        const waitTime = Math.ceil((resetTime * 1000 - Date.now()) / 1000 / 60);
        console.error(`⏰ Rate limited! Try again in ${waitTime} minutes`);
      }
    }
    
    throw error;
  }
}

async function createZoraCoin(post: TwitterPost, imageUrl: string, processedContent: string, linkToPost: string): Promise<string> {
  console.log('🪙 Creating Zora Content Coin with actual tweet image...');

  const ZORA_API_KEY = process.env.ZORA_API_KEY!;
  const PRIVATE_KEY = process.env.PRIVY_PRIVATE_KEY as Hex;
  const SMART_WALLET_ADDRESS = process.env.ZORA_SMART_WALLET_ADDRESS as Address;

  // Set Zora API key
  setApiKey(ZORA_API_KEY);

  // Create EOA account from private key
  const account = privateKeyToAccount(PRIVATE_KEY);

  // Set up viem clients
  const publicClient = createPublicClient({
    chain: base,
    transport: http(process.env.RPC_URL!),
  });

  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(process.env.RPC_URL!),
  });

  try {
    // Generate name using last 5-6 characters from post ID for better uniqueness  
    const postIdHash = post.id.slice(-6); // Use last 6 characters of post ID
    const coinName = `tokenmetrics#${postIdHash}`;
    
    // Use processed content without link
    const description = processedContent;

    // Generate symbol from post ID hash
    const symbol = `TM${postIdHash.toUpperCase()}`;

    console.log('📸 Using actual tweet image with withImageURI approach...');
    console.log('- Coin Name:', coinName);
    console.log('- Symbol:', symbol);
    console.log('- Description:', description.substring(0, 100) + '...');
    console.log('- Image URL:', imageUrl);

    // Use withImageURI to avoid File upload issues
    console.log('🔗 Uploading metadata with tweet image...');
    const { createMetadataParameters } = await createMetadataBuilder()
      .withName(coinName)
      .withSymbol(symbol)
      .withDescription(description)
      .withImageURI(imageUrl) // Use direct Twitter image URL
      .upload(createZoraUploaderForCreator(SMART_WALLET_ADDRESS));

    console.log('✅ Metadata uploaded successfully with tweet image');
    console.log('🪙 Creating Content Coin on Zora...');

    // Create the coin with uploaded metadata
    const result = await createCoin({
      call: {
        creator: SMART_WALLET_ADDRESS,
        ...createMetadataParameters,
        currency: CreateConstants.ContentCoinCurrencies.ZORA,
        chainId: base.id,
        startingMarketCap: CreateConstants.StartingMarketCaps.LOW,
      },
      walletClient,
      publicClient,
    });

    console.log('🎉 SUCCESS! Content Coin created with actual tweet image!');
    console.log('Transaction hash:', result.hash);
    console.log('Coin address:', result.address);
    console.log('Coin name:', coinName);
    console.log('Image used:', imageUrl);
    
    return result.hash;

  } catch (error: any) {
    console.error('❌ Coin creation failed:', error.message);
    console.error('Full error:', error);
    throw error;
  }
}

async function main() {
  console.log('🚀 Starting daily TokenMetrics Zora posting...');
  console.log('Time:', new Date().toISOString());
  console.log('💡 API Usage: Will make only 1 Twitter API call');

  try {
    // Step 1: Load deduplication data
    console.log('📂 Loading posted tweets history...');
    const alreadyPosted = await loadPostedTweets();
    console.log(`📊 Found ${alreadyPosted.size} previously posted tweets`);

    // Step 2: Get latest image post from Twitter (excluding already posted)
    console.log('🔍 Searching for latest image post...');
    const { post, imageUrl, timelineData } = await getLatestImagePost(alreadyPosted);

    // Step 3: Process content (detect threads and summarize if needed)
    console.log('📝 Processing tweet content...');
    const { content, firstTweetId } = await processTwitterContent(post, timelineData);
    const linkToPost = `https://x.com/tokenmetricsinc/status/${firstTweetId}`;
    
    console.log('✅ Processed content:', content.substring(0, 100) + '...');
    console.log('🔗 Link to post:', linkToPost);

    // Step 4: Create Zora Content Coin with processed content
    console.log('🪙 Creating Zora Content Coin...');
    const txHash = await createZoraCoin(post, imageUrl, content, linkToPost);

    // Extract post ID hash for display
    const postIdHash = post.id.slice(-6);
    const coinName = `tokenmetrics#${postIdHash}`;

    console.log('\\n🎊 DAILY POSTING COMPLETED SUCCESSFULLY!');
    console.log('================================');
    console.log('Twitter Post ID:', post.id);
    console.log('Coin Name:', coinName);
    console.log('Zora Transaction:', txHash);
    console.log('Image URL:', imageUrl);
    console.log('Created at:', new Date().toISOString());
    console.log('\\n📊 Post Metrics:');
    console.log('- Likes:', post.public_metrics.like_count);
    console.log('- Retweets:', post.public_metrics.retweet_count);
    console.log('- Replies:', post.public_metrics.reply_count);
    console.log('\\n📝 Post Content:');
    console.log('- Original Text:', post.text);
    console.log('- Processed Content:', content);
    console.log('- Link:', linkToPost);

    // Step 5: Save to deduplication file
    console.log('💾 Saving tweet ID to prevent reposting...');
    await savePostedTweet({
      tweetId: post.id,
      coinName,
      zoraTransaction: txHash,
      postedAt: new Date().toISOString()
    });

    // Log success to file for monitoring
    const logEntry = {
      timestamp: new Date().toISOString(),
      twitterPostId: post.id,
      coinName,
      zoraTransaction: txHash,
      imageUrl,
      originalText: post.text,
      processedContent: content,
      linkToPost,
      metrics: post.public_metrics,
      status: 'SUCCESS'
    };
    
    await fs.appendFile('daily-posting.log', JSON.stringify(logEntry) + '\\n');

  } catch (error: any) {
    console.error('❌ Daily posting failed:', error.message);
    console.error('Full error details:', error);
    
    // Log error to file
    const logEntry = {
      timestamp: new Date().toISOString(),
      error: error.message,
      errorDetails: error.stack || error.toString(),
      status: 'FAILED'
    };
    
    await fs.appendFile('daily-posting.log', JSON.stringify(logEntry) + '\\n');
    
    process.exit(1); // Exit with error code for cron monitoring
  }
}

main().catch(console.error);