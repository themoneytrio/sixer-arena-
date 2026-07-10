import java.io.*;
import java.net.*;

public class EchoClient {
    public static void main(String[] args) {
        try (Socket socket = new Socket("127.0.0.1", 5678);
             BufferedReader userInput = new BufferedReader(new InputStreamReader(System.in));
             BufferedReader in = new BufferedReader(
                 new InputStreamReader(socket.getInputStream()));
             BufferedWriter out = new BufferedWriter(
                 new OutputStreamWriter(socket.getOutputStream()))) {

            String message;

            System.out.println("Enter message:");

            while ((message = userInput.readLine()) != null) {
                out.write(message);
                out.newLine();
                out.flush();

                String response = in.readLine();
                System.out.println("Echoed: " + response);
            }

        } catch (IOException e) {
            e.printStackTrace();
        }
    }
}