/* Easter eggs: the rating joke and the secret code bar (click Curious George). */
document.getElementById('submitRating').onclick = function () {
  const ratingResult = document.getElementById('ratingResult');
  ratingResult.textContent = document.body.classList.contains('halloween')
    ? "Sorry.. these ratings are too SCARY for me to find!"
    : "Thank you for rating.. You gave us.. Uh.. Hold On.. I need to find the ratings.. Give me a second.. almost got them wait no that's not it.. Hold on.. I think this is wait no.. Maybe is it this one? Nope nope, not ratings.. Give me time to think about this.";
};

const SECRET_REDIRECTS = {
  'chaotix': 'games/knuckles/',
  'OG': '/boingagames/original.html',
  'Super Secret': '/boingagames/time.html',
  'DEER': 'games/deer/',
  'april': '/boingagames/april.html',
  'april2': '/boingagames/april2.html',
  'boinga': '/boingagames/boinga.html',
  'parappa': 'games/parappa/',
  'the room in between': '/boingagames/man.html',
  'The room in between': '/boingagames/man.html',
  'DVD': '/boingagames/dvd.html',
  'clock': '/boingagames/clock.html',
  'blast': 'https://www.youtube.com/@blastonianSOF',
  'Blast': 'https://www.youtube.com/@blastonianSOF',
  'place': '/boingagames/boingaplace.html'
};

function openCodeBar() {
  const bar = document.getElementById('codeInputBar');
  bar.classList.remove('glitch-out');
  bar.style.display = 'block';
  void bar.offsetWidth; // force reflow so the animation restarts every time
  bar.classList.add('glitch-in');
}

function closeCodeBar() {
  const bar = document.getElementById('codeInputBar');
  bar.classList.remove('glitch-in');
  bar.classList.add('glitch-out');

  const finish = () => {
    bar.style.display = 'none';
    bar.classList.remove('glitch-out');
    document.getElementById('codeInput').value = '';
    document.getElementById('message').textContent = '';
    bar.removeEventListener('animationend', finish);
  };
  bar.addEventListener('animationend', finish);
  // Fallback in case animations are disabled and animationend never fires
  setTimeout(finish, 400);
}

document.getElementById('curiousGeorge').onclick = openCodeBar;
document.querySelector('#codeInputBar .closeBtn').onclick = closeCodeBar;

document.getElementById('codeInput').addEventListener('input', function () { 
    if (this.value.toLowerCase() === 'gaster') { 
        window.location.reload(); 
    } else if (this.value.toLowerCase() === 'james') { 
        applyTheme('james');
    } 
});

document.getElementById('submitCode').onclick = function () {
  const input = document.getElementById('codeInput').value.trim();
  const messageBox = document.getElementById('message');

  if (SECRET_REDIRECTS[input]) {
    window.location.href = SECRET_REDIRECTS[input];
    return;
  }

  fetch('codes.txt')
    .then(response => {
      if (!response.ok) throw new Error('Network response was not ok');
      return response.text();
    })
    .then(data => {
      const codes = data.split('\n').map(line => line.split(':'));
      const match = codes.find(code => code[0].trim() === input);

      if (match) {
        messageBox.textContent = match[1].trim();
        messageBox.className = 'message';
      } else {
        messageBox.textContent = 'X';
        messageBox.className = 'message error';
      }
    })
    .catch(() => {
      messageBox.textContent = 'X';
      messageBox.className = 'message error';
    });
};
