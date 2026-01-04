import React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { setLongUrl, shortenUrl } from '../store/slices/urlShortenerSlice';
import CustomSlugInput from './CustomSlugInput';
import Button from './Button';

function URLShortenerForm() {
  const dispatch = useDispatch();
  const longUrl = useSelector((state) => state.urlShortener.longUrl);
  const customSlug = useSelector((state) => state.urlShortener.customSlug);
  const isLoading = useSelector((state) => state.urlShortener.isLoading);

  const handleSubmit = async (e) => {
    e.preventDefault();
    await dispatch(shortenUrl({ url: longUrl, customSlug }));
  };

  const handleShortenAndVisit = async () => {
    if (!longUrl) return;

    const result = await dispatch(shortenUrl({ url: longUrl, customSlug }));

    if (shortenUrl.fulfilled.match(result)) {
      const shortUrl = result.payload;
      window.open(shortUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <form id="urlForm" onSubmit={handleSubmit}>
      <div className="form-group">
        <label htmlFor="longUrl">Enter your long URL:</label>
        <input
          type="url"
          id="longUrl"
          name="longUrl"
          placeholder="https://example.com/very-long-url"
          required
          value={longUrl}
          onChange={(e) => dispatch(setLongUrl(e.target.value))}
          disabled={isLoading}
        />
      </div>

      <CustomSlugInput />

      <div className="button-group">
        <Button type="submit" disabled={isLoading}>
          Shorten URL
        </Button>
        <Button
          type="button"
          className="goto-btn"
          onClick={handleShortenAndVisit}
          disabled={isLoading || !longUrl}
        >
          {isLoading ? 'Shortening...' : 'Shorten URL and Visit'}
        </Button>
      </div>
    </form>
  );
}

export default URLShortenerForm;

