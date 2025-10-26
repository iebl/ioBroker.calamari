const { Anthropic } = require('@anthropic-ai/sdk');

// Mapping of model types to their latest versions
// Keep this in sync with lib/aiMode.js
const MODEL_VERSIONS = {
    'sonnet': 'claude-sonnet-4-5-20250929',  // Latest Sonnet 4.5
    'haiku': 'claude-3-5-haiku-20241022'      // Latest Haiku
};

const apiKey = process.argv[2];
const modelTypeOrVersion = process.argv[3] || 'sonnet';

// Map model type to actual version, or use as-is if it looks like a version string
const model = MODEL_VERSIONS[modelTypeOrVersion] || modelTypeOrVersion;

async function testAPI() {
    try {
        console.log('Testing Claude API connection...');
        console.log('Model type:', modelTypeOrVersion);
        console.log('Model version:', model);
        
        const client = new Anthropic({ apiKey });
        
        const startTime = Date.now();
        const message = await client.messages.create({
            model: model,
            max_tokens: 50,
            messages: [{
                role: 'user',
                content: 'Please respond with "Connection successful" if you receive this message.'
            }]
        });
        const duration = Date.now() - startTime;
        
        console.log('\n✅ SUCCESS!');
        console.log('Response time:', duration + 'ms');
        console.log('Input tokens:', message.usage.input_tokens);
        console.log('Output tokens:', message.usage.output_tokens);
        console.log('Response:', message.content[0].text);
        
        process.exit(0);
    } catch (error) {
        console.log('\n❌ FAILED!');
        console.log('Error:', error.message);
        process.exit(1);
    }
}

testAPI();
