export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  try {
    const body = await req.json();
    const apiKey = process.env.GROQ_API_KEY;

    // モデルを呼び出し
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-20b', 
        messages: body.messages,
        reasoning_effort: 'low',
        temperature: 0.7,
        max_completion_tokens: 100
      })
    });
    
    const data = await response.json();
    return new Response(JSON.stringify({ text: data.choices[0].message.content }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
