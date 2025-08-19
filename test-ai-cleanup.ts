// test-ai-cleanup.ts - Test the AI content cleaning with problematic tweet
import 'dotenv/config';
import OpenAI from 'openai';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// Unified AI content cleaning function for both single tweets and threads
async function cleanAndOptimizeContent(content: string, isThread: boolean = false): Promise<string> {
  const contentType = isThread ? 'Twitter thread summary' : 'tweet content';
  
  try {
    const response = await openai.responses.create({
      model: 'gpt-4.1',
      input: `Please clean and optimize this ${contentType} for social media posting:\n\n${content}`,
      instructions: `You are a social media content specialist. Clean and optimize the given ${contentType} following these guidelines:
      
      1. Remove any t.co shortened links (they start with https://t.co/)
      2. Keep the core message and key information intact
      3. Maintain any important numbers, percentages, or metrics  
      4. Keep cryptocurrency symbols (like $ETH, $BTC, $TMAI, etc.)
      5. Make the text clear and engaging for social media
      6. Keep under 250 characters for optimal readability
      7. Don't add emojis unless they were in the original
      8. If text appears truncated, work with what's available
      9. Focus on the main value proposition or key insight
      10. Remove any incomplete sentences at the end
      11. ${isThread ? 'Ensure the summary captures the main thread points' : 'Preserve the original message intent'}
      
      Return only the cleaned, optimized content - no quotes, no explanations.`,
      max_output_tokens: 150
    });

    return response.output_text || content;
  } catch (error: any) {
    console.error('OpenAI API error:', error);
    // Fallback: basic cleanup
    return content
      .replace(/https:\/\/t\.co\/\w+/g, '') // Remove t.co links
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }
}

async function testAICleanup() {
  console.log('🧪 Testing AI content cleanup with problematic tweet...\n');

  // Your problematic tweet example
  const problematicTweet = `🚨 $WIRE is one of many successful bullish signals identified by $TMAI:

• Signal: $0.00019438
• ATH: $0.00398695
• ROI: 20.5x

We're making it easier than ever to spot hidden gems early.

The Token Metrics AI has sent more bullish signals today
and you could catch the https://t.co/DmkJ23onmD`;

  console.log('📝 Original tweet:');
  console.log('================');
  console.log(problematicTweet);
  console.log('\n🔄 Processing with AI...\n');

  try {
    const cleanedContent = await cleanAndOptimizeContent(problematicTweet, false);
    
    console.log('✨ AI-cleaned content:');
    console.log('=====================');
    console.log(cleanedContent);
    console.log('\n📊 Analysis:');
    console.log('- Original length:', problematicTweet.length, 'characters');
    console.log('- Cleaned length:', cleanedContent.length, 'characters');
    console.log('- Removed t.co link:', !cleanedContent.includes('t.co'));
    console.log('- Preserved metrics:', cleanedContent.includes('20.5x'));
    console.log('- Preserved crypto symbols:', cleanedContent.includes('$WIRE') && cleanedContent.includes('$TMAI'));
    console.log('- Under 250 chars:', cleanedContent.length <= 250);
    
    console.log('\n🎯 This cleaned content will be used for Zora posting!');
    
  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
  }
}

testAICleanup().catch(console.error);