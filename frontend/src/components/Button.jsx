import React from 'react';

function Button({ children, onClick, className = '', type = 'button', disabled = false }) {
  return (
    <button type={type} className={className} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export default Button;

