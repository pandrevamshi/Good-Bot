import os

# Greeting
def greetUser():
    """
    Greets the user with a welcome message.
    """
    print("Welcome to Pandre's Universe!")

# Read text from file
def readTextFromFile(filePath):
    """
    Reads text from a file and returns it as a string.
    
    :param filePath: Path to the file to read.
    :return: Content of the file as a string.
    """
    if not os.path.exists(filePath):
        raise FileNotFoundError(f"The file {filePath} does not exist.")
    
    with open(filePath, 'r', encoding='utf-8') as file:
        return file.read()
    return ""
