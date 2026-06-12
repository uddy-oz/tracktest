import { useEffect, useState } from "react";
import type { SpotifyAlbum, SpotifyTrack } from "../lib/spotifyApi";
import { getSpotifyAlbumTracks } from "../lib/spotifyApi";

type QuizProps = {
  selectedAlbum: SpotifyAlbum;
  onRestartApp: () => void;
};

type QuizQuestion = {
  correctTrack: SpotifyTrack;
  options: SpotifyTrack[];
};

function shuffleArray<T>(array: T[]) {
  return [...array].sort(() => Math.random() - 0.5);
}

function buildQuizQuestions(tracks: SpotifyTrack[]) {
  const quizTracks = shuffleArray(tracks).slice(0, 5);

  return quizTracks.map((correctTrack) => {
    const wrongOptions = shuffleArray(
      tracks.filter((track) => track.id !== correctTrack.id)
    ).slice(0, 3);

    return {
      correctTrack,
      options: shuffleArray([correctTrack, ...wrongOptions]),
    };
  });
}

function Quiz({ selectedAlbum, onRestartApp }: QuizProps) {
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [guess, setGuess] = useState("");
  const [message, setMessage] = useState("");
  const [score, setScore] = useState(0);
  const [hasAnswered, setHasAnswered] = useState(false);
  const [isQuizComplete, setIsQuizComplete] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadTracks() {
      try {
        setIsLoading(true);
        setError("");

        const albumTracks = await getSpotifyAlbumTracks(selectedAlbum.id);

        if (albumTracks.length < 4) {
          setError("Not enough tracks for a quiz.");
          return;
        }

        const cleanedTracks = albumTracks.slice(0, 20);
        const quizQuestions = buildQuizQuestions(cleanedTracks);

        setQuestions(quizQuestions);
      } catch (error) {
        console.error(error);
        setError("Could not load tracks for this album.");
      } finally {
        setIsLoading(false);
      }
    }

    loadTracks();
  }, [selectedAlbum.id]);

  function checkAnswer() {
    if (guess === "") {
      setMessage("Pick an answer first.");
      return;
    }

    if (hasAnswered) {
      setMessage("You already answered this question.");
      return;
    }

    const correctAnswer = questions[currentQuestionIndex].correctTrack.name;

    if (guess.toLowerCase() === correctAnswer.toLowerCase()) {
      setMessage("Correct. You know ball.");
      setScore(score + 1);
    } else {
      setMessage(`Wrong. The correct answer was ${correctAnswer}.`);
    }

    setHasAnswered(true);
  }

  function goToNextQuestion() {
    setCurrentQuestionIndex(currentQuestionIndex + 1);
    setGuess("");
    setMessage("");
    setHasAnswered(false);
  }

  function finishQuiz() {
    setIsQuizComplete(true);
  }

  function restartQuiz() {
    setCurrentQuestionIndex(0);
    setGuess("");
    setMessage("");
    setScore(0);
    setHasAnswered(false);
    setIsQuizComplete(false);
    setQuestions(buildQuizQuestions(questions.map((question) => question.correctTrack)));
  }

  if (isLoading) {
    return (
      <section className="quiz">
        <h2>Loading tracks...</h2>
      </section>
    );
  }

  if (error) {
    return (
      <section className="quiz">
        <h2>{error}</h2>
        <button onClick={onRestartApp}>Choose Another Album</button>
      </section>
    );
  }

  if (questions.length === 0) {
    return (
      <section className="quiz">
        <h2>No questions available.</h2>
        <button onClick={onRestartApp}>Choose Another Album</button>
      </section>
    );
  }

  if (isQuizComplete) {
    return (
      <section className="quiz">
        <h2>Quiz complete</h2>

        <p className="score">
          Final score: {score} / {questions.length}
        </p>

        <p className="quiz-message">
          {score === questions.length
            ? "Perfect score. Certified album demon."
            : "Not bad. Run it back and beat your score."}
        </p>

        <div className="hero-buttons">
          <button onClick={restartQuiz}>Restart Quiz</button>
          <button className="secondary-button" onClick={onRestartApp}>
            Choose Another Album
          </button>
        </div>
      </section>
    );
  }

  const currentQuestion = questions[currentQuestionIndex];

  return (
    <section className="quiz">
      <h2>Guess the song</h2>

      <p className="score">
        Score: {score} / {questions.length}
      </p>

      <p className="quiz-clue">
        {selectedAlbum.title} quiz: Track {currentQuestionIndex + 1} is playing...
      </p>

      <div className="song-options">
        {currentQuestion.options.map((track) => (
          <button
            key={track.id}
            className={guess === track.name ? "song-button selected-song" : "song-button"}
            onClick={() => setGuess(track.name)}
            disabled={hasAnswered}
          >
            {track.name}
          </button>
        ))}
      </div>

      {guess && (
        <p className="selected-guess">
          Your guess: <strong>{guess}</strong>
        </p>
      )}

      <button onClick={checkAnswer}>Submit Answer</button>

      {hasAnswered && currentQuestionIndex < questions.length - 1 && (
        <button className="next-button" onClick={goToNextQuestion}>
          Next Question
        </button>
      )}

      {hasAnswered && currentQuestionIndex === questions.length - 1 && (
        <button className="next-button" onClick={finishQuiz}>
          Finish Quiz
        </button>
      )}

      {message && <p className="quiz-message">{message}</p>}
    </section>
  );
}

export default Quiz;