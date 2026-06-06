# hello-world

シンプルなPythonのhello-worldプロジェクトです。

## 使い方

\\\ash
python hello.py
\\\

## テスト

\\\ash
python test_hello.py
\\\
"@ | Out-File -Encoding utf8 README.md

@"
def greet(name="World"):
    return f"Hello, {name}!"

if __name__ == "__main__":
    print(greet())
