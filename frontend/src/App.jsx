import React from 'react';
import { useSelector } from 'react-redux';
import URLShortenerForm from './components/URLShortenerForm';
import ResultDisplay from './components/ResultDisplay';
import ErrorDisplay from './components/ErrorDisplay';
import LoadingDisplay from './components/LoadingDisplay';
import Footer from './components/Footer';
import './styles/App.css';

function App() {
  const isLoading = useSelector((state) => state.urlShortener.isLoading);

  return (
    <>
      <div className="container">
        <h1>URL Shortener</h1>
        <URLShortenerForm />
        <LoadingDisplay show={isLoading} />
        <ErrorDisplay />
        <ResultDisplay />
      </div>
      <Footer />
    </>
  );
}

export default App;
