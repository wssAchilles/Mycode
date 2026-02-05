const GIPHY_API_KEY = import.meta.env.VITE_GIPHY_API_KEY as string | undefined;

export interface GiphyGif {
  id: string;
  title: string;
  images: {
    original: { url: string; width: string; height: string };
    fixed_width: { url: string; width: string; height: string };
  };
}

const buildUrl = (path: string, params: Record<string, string>) => {
  const url = new URL(`https://api.giphy.com/v1/gifs/${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
};

const requireKey = () => {
  if (!GIPHY_API_KEY) {
    throw new Error('缺少 GIPHY API Key');
  }
};

export const giphyApi = {
  async search(query: string, limit: number = 24): Promise<GiphyGif[]> {
    requireKey();
    const url = buildUrl('search', {
      api_key: GIPHY_API_KEY!,
      q: query,
      limit: String(limit),
      rating: 'pg-13',
      lang: 'zh',
    });
    const response = await fetch(url);
    const data = await response.json();
    return data.data || [];
  },

  async trending(limit: number = 24): Promise<GiphyGif[]> {
    requireKey();
    const url = buildUrl('trending', {
      api_key: GIPHY_API_KEY!,
      limit: String(limit),
      rating: 'pg-13',
    });
    const response = await fetch(url);
    const data = await response.json();
    return data.data || [];
  },
};
