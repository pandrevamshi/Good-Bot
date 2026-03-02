import requests

from langchain.tools import Tool

https://www.themealdb.com/api/json/v1/1/search.php?s=biryani

def describe_dish(dish_name):
    response = requests.get(
        f'https://www.themealdb.com/api/json/v1/1/search.php?s={dish_name}'
    )
    response = response.json()

    return response['strInstructions'], response['strYoutube']

describe_dish_tool = Tool (
    name = 'describe_dish'
    func=describe_dish
    description='Calls the API using the dish name and responds with the instructions and youtube url'
)

tools = [
    {
        "type": "function",
        "function": {
            "name": "describe_dish",
            "description": "Get the instructions and YouTube link for a specific dish",
            "parameters": {
                "type": "object",
                "properties": {
                    "dish_name" : {"type" : "string"}
                },
                "required": ["dish_name"],
                "additionalProperties": False,
            },
            "strict": True,
        },
    }
]

