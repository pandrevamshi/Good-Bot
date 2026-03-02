from openai import OpenAI
import os

from Utility.GeneralUtil import readTextFromFile

# Initialize Open AI API using the developer key

client = OpenAI(

    # Read API KEY from env variable
    api_key=os.getenv('OPENAI_API_KEY')
)