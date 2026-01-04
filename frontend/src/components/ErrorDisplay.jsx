import React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { clearError } from '../store/slices/urlShortenerSlice';

function ErrorDisplay() {
  const dispatch = useDispatch();
  const error = useSelector((state) => state.urlShortener.error);

  if (!error) return null;

  return (
    <div className="error show">
      <button className="error-close" onClick={() => dispatch(clearError())} aria-label="Close error">
        ×
      </button>
      {error}
    </div>
  );
}

export default ErrorDisplay;
