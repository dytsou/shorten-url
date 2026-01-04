import React from 'react';

function LoadingDisplay({ show }) {
  if (!show) return null;

  return (
    <div className="loading show">
      <p>Generating short URL...</p>
    </div>
  );
}

export default LoadingDisplay;
