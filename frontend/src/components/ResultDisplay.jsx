import React, { useRef, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { setCopySuccess } from '../store/slices/urlShortenerSlice';
import { copyToClipboard, selectText } from '../utils/clipboard';

function ResultDisplay() {
  const dispatch = useDispatch();
  const shortUrl = useSelector((state) => state.urlShortener.shortUrl);
  const copySuccess = useSelector((state) => state.urlShortener.copySuccess);
  const inputRef = useRef(null);

  useEffect(() => {
    if (shortUrl && inputRef.current) {
      inputRef.current.value = shortUrl;
    }
  }, [shortUrl]);

  const handleCopy = async () => {
    if (!shortUrl) return;

    const result = await copyToClipboard(shortUrl);

    if (result.fallback && inputRef.current) {
      selectText(inputRef.current);
    }

    dispatch(setCopySuccess(true));
    setTimeout(() => {
      dispatch(setCopySuccess(false));
    }, 2000);
  };

  if (!shortUrl) return null;

  return (
    <div className="result show">
      <h3>Your shortened URL:</h3>
      <div className="shortened-url">
        <input type="text" id="shortUrlOutput" ref={inputRef} readOnly />
        <button className="copy-btn" onClick={handleCopy}>
          {copySuccess ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

export default ResultDisplay;
