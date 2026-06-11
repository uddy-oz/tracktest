import { useState } from "react";

const quizQuestions = [
  {
    clue: "Track 1 from the selected album is playing...",
    correctAnswer: "Marvins Room",
    options: ["Marvins Room", "Headlines", "Crew Love", "Take Care"],
  },
  {
    clue: "Track 2 from the selected album is playing...",
    correctAnswer: "Headlines",
    options: ["The Motto", "Headlines", "Practice", "Over My Dead Body"],
  },
  {
    clue: "Track 3 from the selected album is playing...",
    correctAnswer: "Crew Love",
    options: ["Crew Love", "Shot For Me", "Make Me Proud", "HYFR"],
  },
];

type QuizProps = {
  selectedAlbum: string;
  onRestartApp: () => void;
};

function Quiz({ selectedAlbum, onRestartApp }: QuizProps) {
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [guess, setGuess] = useState("");
  const [message, setMessage] = useState("");
  const [score, setScore] = useState(0);
  const [hasAnswered, setHasAnswered] = useState(false);
  const [isQuizComplete, setIsQuizComplete] = useState(false);

  const currentQuestion = quizQuestions[currentQuestionIndex];

  function checkAnswer() {
    if (guess === "") {
      setMessage("Pick an answer first.");
      return;
    }

    if (hasAnswered) {
      setMessage("You already answered this question.");
      return;
    }

    if (guess.toLowerCase() === currentQuestion.correctAnswer.toLowerCase()) {
      setMessage("Correct. You know ball.");
      setScore(score + 1);
    } else {
      setMessage(`Wrong. The correct answer was ${currentQuestion.correctAnswer}.`);
    }

    setHasAnswered(true);
  }

  function goToNextQuestion() {
    const nextQuestionIndex = currentQuestionIndex + 1;

    setCurrentQuestionIndex(nextQuestionIndex);
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
  }

  if (isQuizComplete) {
    return (
      <section className="quiz">
        <h2>Quiz complete</h2>

        <p className="score">
          Final score: {score} / {quizQuestions.length}
        </p>

        <p className="quiz-message">
          {score === quizQuestions.length
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

  return (
    <section className="quiz">
      <h2>Guess the song</h2>

      <p className="score">
        Score: {score} / {quizQuestions.length}
      </p>

      <p className="quiz-clue">
  {selectedAlbum} quiz: {currentQuestion.clue}
</p>

      <div className="song-options">
        {currentQuestion.options.map((song) => (
          <button
            key={song}
            className={guess === song ? "song-button selected-song" : "song-button"}
            onClick={() => setGuess(song)}
            disabled={hasAnswered}
          >
            {song}
          </button>
        ))}
      </div>

      {guess && (
        <p className="selected-guess">
          Your guess: <strong>{guess}</strong>
        </p>
      )}

      <button onClick={checkAnswer}>Submit Answer</button>

      {hasAnswered && currentQuestionIndex < quizQuestions.length - 1 && (
        <button className="next-button" onClick={goToNextQuestion}>
          Next Question
        </button>
      )}

      {hasAnswered && currentQuestionIndex === quizQuestions.length - 1 && (
        <button className="next-button" onClick={finishQuiz}>
          Finish Quiz
        </button>
      )}

      {message && <p className="quiz-message">{message}</p>}
    </section>
  );
}

export default Quiz;