import java.io.*;
import java.net.*;

public class ChatClient {
    public static void main(String[] args) {

        try (Socket socket = new Socket("127.0.0.1", 5678)) {

            System.out.println("Connected to server.");

            BufferedReader in = new BufferedReader(
                    new InputStreamReader(socket.getInputStream()));

            PrintWriter out = new PrintWriter(
                    socket.getOutputStream(), true);

            BufferedReader keyboard = new BufferedReader(
                    new InputStreamReader(System.in));

            String msg;

            while (true) {
                // Send message
                System.out.print("You: ");
                msg = keyboard.readLine();

                if (msg.equalsIgnoreCase("exit")) {
                    out.println("exit");
                    break;
                }

                out.println(msg);

                // Receive reply
                msg = in.readLine();

                if (msg == null || msg.equalsIgnoreCase("exit")) {
                    System.out.println("Server disconnected.");
                    break;
                }

                System.out.println("Server: " + msg);
            }

        } catch (IOException e) {
            e.printStackTrace(); // better debugging
        }
    }
}