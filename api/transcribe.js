export const config = {
  runtime: 'edge', // Edgeランタイムを使用（FormDataの処理が簡単になります）
};

export default async function handler(req) {
  // POSTリクエスト以外は弾く
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    // フロントエンドから送られた音声データを受け取る
    const formData = await req.formData();
    
    // ★ ここでVercelの環境変数が効きます！ ★
    const apiKey = process.env.GROQ_API_KEY;

    // Groq APIへリクエストを転送
    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      body: formData,
    });

    const data = await response.json();
    
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
