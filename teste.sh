teste
npm exec --yes --package=node@22 -- node /opt/homebrew/lib/node_modules/npm/bin/npm-cli.js --prefix backend run dev

cd ~/faculdade/PI/farm/frontend
python3 -m http.server 5500

for port in 3000 5500; do
  pids=$(lsof -tiTCP:$port -sTCP:LISTEN)
  [[ -z "$pids" ]] || kill $pids
done