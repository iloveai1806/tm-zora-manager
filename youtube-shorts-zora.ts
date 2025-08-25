// youtube-shorts-zora.ts - YouTube Shorts to Zora automation
import 'dotenv/config';
import { createCoin, CreateConstants, setApiKey, createMetadataBuilder, createZoraUploaderForCreator } from "@zoralabs/coins-sdk";
import { Address, Hex, createWalletClient, createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import fs from 'node:fs/promises';
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

interface YouTubeVideo {
  id: string;
  title: string;
  description: string;
  publishedAt: string;
  thumbnailUrl: string;
  channelTitle: string;
  duration?: string;
}

interface PostedVideoRecord {
  videoId: string;
  coinName: string;
  zoraTransaction: string;
  postedAt: string;
}

const POSTED_VIDEOS_FILE = 'posted-videos.json';
const TM_CHANNEL_ID = "UCH9MOLQ_KUpZ_cw8uLGUisA";

// Convert channel ID to Shorts playlist ID
function getShortsPlaylistId(channelId: string): string {
  // Replace "UC" with "UUSH" to get Shorts playlist
  if (channelId.startsWith('UC')) {
    return 'UUSH' + channelId.substring(2);
  }
  throw new Error('Invalid channel ID format');
}

async function getSpecificVideo(videoId: string): Promise<YouTubeVideo> {
  console.log(`🎯 Fetching specific YouTube video: ${videoId}...`);
  
  const apiKey = process.env.YOUTUBE_API_KEY!;
  
  try {
    // Get video details by ID
    const videoUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${apiKey}`;
    
    console.log('📡 Making YouTube API call for specific video...');
    const response = await fetch(videoUrl);
    
    if (!response.ok) {
      throw new Error(`YouTube API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (!data.items || data.items.length === 0) {
      throw new Error(`Video not found: ${videoId}`);
    }
    
    const video = data.items[0];
    console.log(`✅ Found video: ${video.snippet.title}`);
    
    return {
      id: video.id,
      title: video.snippet.title,
      description: video.snippet.description,
      publishedAt: video.snippet.publishedAt,
      thumbnailUrl: video.snippet.thumbnails?.maxres?.url || 
                    video.snippet.thumbnails?.high?.url ||
                    video.snippet.thumbnails?.medium?.url,
      channelTitle: video.snippet.channelTitle
    };
    
  } catch (error: any) {
    console.error('❌ YouTube API Error:', error.message);
    throw error;
  }
}

async function getLatestShorts(alreadyPosted: Set<string>): Promise<YouTubeVideo> {
  console.log('🎥 Fetching latest video from TokenMetrics channel...');
  
  const apiKey = process.env.YOUTUBE_API_KEY!;
  const maxResults = 1; // Get only the latest video
  
  try {
    // First, get the channel's uploads playlist
    const channelUrl = `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${TM_CHANNEL_ID}&key=${apiKey}`;
    
    console.log('📡 Getting channel uploads playlist...');
    const channelResponse = await fetch(channelUrl);
    
    if (!channelResponse.ok) {
      throw new Error(`YouTube API error: ${channelResponse.status} ${channelResponse.statusText}`);
    }
    
    const channelData = await channelResponse.json();
    
    if (!channelData.items || channelData.items.length === 0) {
      throw new Error('Channel not found');
    }
    
    const uploadsPlaylistId = channelData.items[0].contentDetails.relatedPlaylists.uploads;
    console.log('📋 Uploads playlist ID:', uploadsPlaylistId);
    
    // Get recent videos from uploads playlist
    const playlistUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=${maxResults}&order=date&key=${apiKey}`;
    
    console.log('📡 Making YouTube API call for recent videos...');
    const response = await fetch(playlistUrl);
    
    if (!response.ok) {
      throw new Error(`YouTube API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (!data.items || data.items.length === 0) {
      throw new Error('No videos found in channel');
    }
    
    console.log(`📊 Found ${data.items.length} video (latest)`);
    console.log(`🔍 Already posted: ${alreadyPosted.size} videos tracked`);
    
    // Get the single latest video
    const item = data.items[0];
    const videoId = item.snippet.resourceId.videoId;
    const title = item.snippet.title;
    const description = item.snippet.description;
    const publishedAt = item.snippet.publishedAt;
    const thumbnailUrl = item.snippet.thumbnails?.maxres?.url || 
                        item.snippet.thumbnails?.high?.url ||
                        item.snippet.thumbnails?.medium?.url;
    
    console.log(`🔍 Checking latest video: ${videoId}...`);
    console.log(`  Title: ${title.substring(0, 50)}...`);
    console.log(`  Published: ${publishedAt}`);
    
    // Check if already posted
    if (alreadyPosted.has(videoId)) {
      console.log('  ❌ Latest video already posted to Zora');
      throw new Error('Latest video has already been posted');
    }
    
    console.log('✅ Latest video is new - ready to post!');
    
    return {
      id: videoId,
      title,
      description,
      publishedAt,
      thumbnailUrl,
      channelTitle: item.snippet.channelTitle
    };
    
  } catch (error: any) {
    console.error('❌ YouTube API Error:', error.message);
    
    // Check for quota exceeded
    if (error.message.includes('403') || error.message.includes('quota')) {
      console.error('⚠️ YouTube API quota exceeded. Try again later.');
    }
    
    throw error;
  }
}

async function downloadShortVideo(videoId: string): Promise<{ videoPath: string, thumbnailPath: string }> {
  console.log(`📥 Downloading video: ${videoId}...`);
  
  // Create downloads directory in project root if it doesn't exist
  const downloadsDir = path.join(__dirname, 'downloads');
  await fs.mkdir(downloadsDir, { recursive: true });
  
  // Different format strategies to try in order
  const formatStrategies = [
    // Strategy 1: Specific formats with English audio
    '232+233-9/231+233-9/230+233-9',
    // Strategy 2: Specific formats with any audio
    '232+233/231+233/230+233',
    // Strategy 3: Best video with audio under 720p
    'best[height<=720]',
    // Strategy 4: Best mp4 format
    'best[ext=mp4]',
    // Strategy 5: Just best overall
    'best'
  ];
  
  for (let i = 0; i < formatStrategies.length; i++) {
    const formatString = formatStrategies[i];
    console.log(`🔧 Trying format strategy ${i + 1}/${formatStrategies.length}: ${formatString}`);
    
    try {
      const result = await tryDownloadWithFormat(videoId, downloadsDir, formatString);
      console.log(`✅ Success with format strategy ${i + 1}!`);
      return result;
    } catch (error: any) {
      console.log(`❌ Format strategy ${i + 1} failed:`, error.message);
      if (i === formatStrategies.length - 1) {
        // Last strategy failed, throw the error
        throw error;
      }
      // Continue to next strategy
    }
  }
  
  throw new Error('All format strategies failed');
}

async function tryDownloadWithFormat(videoId: string, downloadsDir: string, formatString: string): Promise<{ videoPath: string, thumbnailPath: string }> {
  const { spawn } = require('child_process');
  
  const downloadProcess = spawn('yt-dlp', [
    `https://www.youtube.com/watch?v=${videoId}`,
    '-f', formatString,
    '-o', `${downloadsDir}/${videoId}.%(ext)s`,
    '--write-thumbnail',
    '--convert-thumbnails', 'jpg',
    '--no-playlist',
    '--merge-output-format', 'mp4' // Try to ensure mp4 output
  ]);
  
  // Capture output for debugging
  let stdout = '';
  let stderr = '';
  
  downloadProcess.stdout.on('data', (data: Buffer) => {
    stdout += data.toString();
  });
  
  downloadProcess.stderr.on('data', (data: Buffer) => {
    stderr += data.toString();
  });
  
  return new Promise((resolve, reject) => {
    downloadProcess.on('close', async (code: number) => {
      if (code === 0) {
        // Expected file paths
        const videoPath = path.join(downloadsDir, `${videoId}.mp4`);
        const thumbnailPath = path.join(downloadsDir, `${videoId}.jpg`);
        
        // Check if files exist
        const videoExists = await fs.access(videoPath).then(() => true).catch(() => false);
        const thumbExists = await fs.access(thumbnailPath).then(() => true).catch(() => false);
        
        if (videoExists && thumbExists) {
          console.log('📱 Video file:', videoPath);
          console.log('🖼️ Thumbnail file:', thumbnailPath);
          resolve({ videoPath, thumbnailPath });
        } else {
          // Try to find the actual files
          console.log('🔍 Searching for downloaded files...');
          try {
            const files = await fs.readdir(downloadsDir);
            const videoFile = files.find(f => f.startsWith(videoId) && (f.endsWith('.mp4') || f.endsWith('.webm') || f.endsWith('.mkv')));
            const thumbFile = files.find(f => f.startsWith(videoId) && f.endsWith('.jpg'));
            
            if (videoFile && thumbFile) {
              const actualVideoPath = path.join(downloadsDir, videoFile);
              const actualThumbPath = path.join(downloadsDir, thumbFile);
              console.log('📱 Found video file:', actualVideoPath);
              console.log('🖼️ Found thumbnail file:', actualThumbPath);
              resolve({ videoPath: actualVideoPath, thumbnailPath: actualThumbPath });
            } else {
              console.log('Available files:', files);
              reject(new Error(`Downloaded files not found. Video: ${videoFile}, Thumbnail: ${thumbFile}`));
            }
          } catch (listError) {
            reject(new Error(`Failed to list downloaded files: ${listError}`));
          }
        }
      } else {
        console.log('yt-dlp stdout:', stdout);
        console.log('yt-dlp stderr:', stderr);
        reject(new Error(`yt-dlp failed with exit code ${code}: ${stderr}`));
      }
    });
    
    downloadProcess.on('error', (error: Error) => {
      reject(new Error(`yt-dlp spawn error: ${error.message}`));
    });
  });
}

async function optimizeContentWithAI(title: string, description: string): Promise<string> {
  try {
    const response = await openai.responses.create({
      model: 'gpt-4.1',
      input: `Please create an engaging social media caption for this YouTube Short:\n\nTitle: ${title}\n\nDescription: ${description}`,
      instructions: `You are a social media content specialist. Create an optimized caption following these guidelines:
      
      1. Keep under 200 characters for optimal readability
      2. Remove any hashtags (#) - strip them completely
      3. Keep cryptocurrency symbols (like $ETH, $BTC, etc.)
      4. Make it engaging and clear for social media
      5. Focus on the main value proposition
      6. Don't add emojis unless they were in the original
      7. Remove any links or URLs completely
      8. Preserve the core message and insights
      9. Strip any existing links if they appear in the content
      
      Return only the optimized caption - no quotes, no explanations.`,
      max_output_tokens: 100
    });

    return response.output_text || title;
  } catch (error: any) {
    console.error('OpenAI API error:', error);
    // Fallback: use title if AI fails
    return title;
  }
}

async function createZoraCoinWithVideo(video: YouTubeVideo, videoPath: string, thumbnailPath: string): Promise<string> {
  console.log('🪙 Creating Zora Content Coin with YouTube Short...');

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
    // Use the actual YouTube video title as coin name
    const coinName = video.title;
    
    // Optimize content with AI
    console.log('🤖 Optimizing content with AI...');
    const optimizedContent = await optimizeContentWithAI(video.title, video.description);
    
    // Use optimized content without link
    const description = optimizedContent;
    
    // Generate symbol from video ID hash
    const videoIdHash = video.id.slice(-6); // Use last 6 characters of video ID
    const symbol = `TM${videoIdHash.toUpperCase()}`;

    console.log('🎬 Creating coin with video content...');
    console.log('- Coin Name:', coinName);
    console.log('- Symbol:', symbol);
    console.log('- Description:', description.substring(0, 100) + '...');
    console.log('- Video file:', videoPath);
    console.log('- Thumbnail file:', thumbnailPath);

    // Read video and thumbnail files
    const videoBuffer = await fs.readFile(videoPath);
    const thumbnailBuffer = await fs.readFile(thumbnailPath);
    
    // Create File objects
    const videoFile = new NodeFile([videoBuffer], `${video.id}.mp4`, { type: 'video/mp4' });
    const thumbnailFile = new NodeFile([thumbnailBuffer], `${video.id}_thumb.jpg`, { type: 'image/jpeg' });

    console.log('🔗 Uploading video and thumbnail to IPFS...');
    
    // Upload video and thumbnail separately first
    const thumbnailUploadResult = await createZoraUploaderForCreator(SMART_WALLET_ADDRESS).upload(thumbnailFile);
    const videoUploadResult = await createZoraUploaderForCreator(SMART_WALLET_ADDRESS).upload(videoFile);
    
    console.log('✅ Files uploaded to IPFS');
    console.log('- Thumbnail result:', thumbnailUploadResult);
    console.log('- Video result:', videoUploadResult);
    
    // Extract URIs from upload results 
    const thumbnailURI = thumbnailUploadResult.url;
    const videoURI = videoUploadResult.url;
    
    console.log('- Thumbnail URI:', thumbnailURI);
    console.log('- Video URI:', videoURI);
    
    // Create metadata with video content - use manual approach for guaranteed video support
    console.log('🔗 Creating metadata with video content...');
    
    // Create metadata JSON manually with animation_url and content for full video support
    const metadata = {
      name: coinName,
      symbol: symbol,
      description: description,
      image: thumbnailURI,
      animation_url: videoURI,
      content: {
        mime: "video/mp4",
        uri: videoURI
      },
      properties: {
        category: "social"
      }
    };
    
    // Upload the custom metadata
    const metadataBlob = new Blob([JSON.stringify(metadata)], { type: 'application/json' });
    const metadataFile = new NodeFile([metadataBlob], 'metadata.json', { type: 'application/json' });
    const metadataUploadResult = await createZoraUploaderForCreator(SMART_WALLET_ADDRESS).upload(metadataFile);
    
    const createMetadataParameters = {
      name: coinName,
      symbol: symbol,
      metadata: {
        type: "RAW_URI" as const,
        uri: metadataUploadResult.url
      }
    };

    console.log('✅ Video metadata uploaded successfully');
    console.log('🪙 Creating Content Coin on Zora...');

    // Create the coin with uploaded metadata
    const result = await createCoin({
      call: {
        creator: SMART_WALLET_ADDRESS,
        name: createMetadataParameters.name,
        symbol: createMetadataParameters.symbol,
        metadata: createMetadataParameters.metadata,
        currency: CreateConstants.ContentCoinCurrencies.ZORA,
        chainId: base.id,
        startingMarketCap: CreateConstants.StartingMarketCaps.LOW,
      },
      walletClient,
      publicClient,
    });

    console.log('🎉 SUCCESS! Content Coin created with YouTube Short!');
    console.log('Transaction hash:', result.hash);
    console.log('Coin address:', result.address);
    console.log('Coin name:', coinName);
    console.log('Original video:', `https://youtube.com/shorts/${video.id}`);
    
    return result.hash;

  } catch (error: any) {
    console.error('❌ Coin creation failed:', error.message);
    console.error('Full error:', error);
    throw error;
  } finally {
    // Clean up downloaded files
    try {
      await fs.unlink(videoPath);
      await fs.unlink(thumbnailPath);
      console.log('🧹 Cleaned up downloaded files');
    } catch (cleanupError) {
      console.warn('⚠️ Failed to clean up files:', cleanupError);
    }
  }
}

async function loadPostedVideos(): Promise<Set<string>> {
  try {
    const data = await fs.readFile(POSTED_VIDEOS_FILE, 'utf8');
    const records: PostedVideoRecord[] = JSON.parse(data);
    return new Set(records.map(record => record.videoId));
  } catch (error) {
    // File doesn't exist yet, return empty set
    return new Set();
  }
}

async function savePostedVideo(record: PostedVideoRecord): Promise<void> {
  try {
    let records: PostedVideoRecord[] = [];
    
    // Load existing records
    try {
      const data = await fs.readFile(POSTED_VIDEOS_FILE, 'utf8');
      records = JSON.parse(data);
    } catch (error) {
      // File doesn't exist, start with empty array
    }
    
    // Add new record
    records.push(record);
    
    // Keep only the last 100 records to prevent the file from growing too large
    if (records.length > 100) {
      records = records.slice(-100);
    }
    
    // Save back to file
    await fs.writeFile(POSTED_VIDEOS_FILE, JSON.stringify(records, null, 2));
    console.log('✅ Video ID saved to deduplication file');
    
  } catch (error: any) {
    console.error('⚠️ Failed to save posted video record:', error.message);
    // Don't throw - this shouldn't break the main flow
  }
}

async function main() {
  console.log('🚀 Starting YouTube Shorts to Zora automation...');
  console.log('Time:', new Date().toISOString());
  console.log('📺 Channel:', `https://youtube.com/channel/${TM_CHANNEL_ID}`);

  // Check for command line argument
  const args = process.argv.slice(2);
  const specificVideoId = args[0];

  try {
    // Step 1: Load deduplication data (only for latest mode)
    let alreadyPosted = new Set<string>();
    if (!specificVideoId) {
      console.log('📂 Loading posted videos history...');
      alreadyPosted = await loadPostedVideos();
      console.log(`📊 Found ${alreadyPosted.size} previously posted videos`);
    }

    // Step 2: Get video from YouTube
    let targetVideo: YouTubeVideo;
    if (specificVideoId) {
      console.log(`🎯 Processing specific video: ${specificVideoId}`);
      targetVideo = await getSpecificVideo(specificVideoId);
      
      // Check if already posted
      if (alreadyPosted.has(specificVideoId)) {
        console.log('⚠️ Warning: This video was already posted to Zora');
        console.log('Continuing anyway...');
      }
    } else {
      console.log('🔍 Searching for latest YouTube video...');
      targetVideo = await getLatestShorts(alreadyPosted);
    }

    // Step 3: Download the video
    console.log('📥 Downloading video and thumbnail...');
    const { videoPath, thumbnailPath } = await downloadShortVideo(targetVideo.id);

    // Step 4: Create Zora Content Coin with video
    console.log('🪙 Creating Zora Content Coin...');
    const txHash = await createZoraCoinWithVideo(targetVideo, videoPath, thumbnailPath);

    // Use the actual video title as coin name for display
    const coinName = targetVideo.title;

    console.log('\n🎊 YOUTUBE VIDEO POSTING COMPLETED SUCCESSFULLY!');
    console.log('===============================================');
    console.log('Mode:', specificVideoId ? 'Specific Video' : 'Latest Short');
    console.log('YouTube Video ID:', targetVideo.id);
    console.log('Video Title:', targetVideo.title);
    console.log('Coin Name:', coinName);
    console.log('Zora Transaction:', txHash);
    console.log('YouTube URL:', `https://youtube.com/shorts/${targetVideo.id}`);
    console.log('Published:', targetVideo.publishedAt);
    console.log('Created at:', new Date().toISOString());

    // Step 5: Save to deduplication file (only for latest mode)
    if (!specificVideoId) {
      console.log('💾 Saving video ID to prevent reposting...');
      await savePostedVideo({
        videoId: targetVideo.id,
        coinName,
        zoraTransaction: txHash,
        postedAt: new Date().toISOString()
      });
    } else {
      console.log('🔄 Skipping deduplication save for specific video mode');
    }

    // Log success to file for monitoring
    const logEntry = {
      timestamp: new Date().toISOString(),
      mode: specificVideoId ? 'specific' : 'latest',
      youtubeVideoId: targetVideo.id,
      videoTitle: targetVideo.title,
      coinName,
      zoraTransaction: txHash,
      youtubeUrl: `https://youtube.com/shorts/${targetVideo.id}`,
      publishedAt: targetVideo.publishedAt,
      status: 'SUCCESS'
    };
    
    await fs.appendFile('youtube-posting.log', JSON.stringify(logEntry) + '\n');

  } catch (error: any) {
    console.error('❌ YouTube Shorts posting failed:', error.message);
    console.error('Full error details:', error);
    
    // Log error to file
    const logEntry = {
      timestamp: new Date().toISOString(),
      error: error.message,
      errorDetails: error.stack || error.toString(),
      status: 'FAILED'
    };
    
    await fs.appendFile('youtube-posting.log', JSON.stringify(logEntry) + '\n');
    
    process.exit(1); // Exit with error code for cron monitoring
  }
}

main().catch(console.error);