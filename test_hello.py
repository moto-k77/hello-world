from hello import greet

def test_greet_default():
    assert greet() == "Hello, World!"

def test_greet_with_name():
    assert greet("Python") == "Hello, Python!"

def test_greet_empty_string():
    assert greet("") == "Hello, !"
